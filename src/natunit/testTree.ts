import { TextDecoder } from 'util';
import * as vscode from 'vscode';
import { parseMarkdown } from './parser';

const textDecoder = new TextDecoder('utf-8');

export type MarkdownTestData = NatUnitTestFile | TestHeading | TestCase;

export const testData = new WeakMap<vscode.TestItem, MarkdownTestData>();

let generationCounter = 0;

export const getContentFromFilesystem = async (uri: vscode.Uri) => {
	try {
		const rawContent = await vscode.workspace.fs.readFile(uri);
		return textDecoder.decode(rawContent);
	} catch (e) {
		console.warn(`Error providing tests for ${uri.fsPath}`, e);
		return '';
	}
};

export class NatUnitTestFile {
	public didResolve = false;

	public async updateFromDisk(controller: vscode.TestController, item: vscode.TestItem) {
		try {
			const content = await getContentFromFilesystem(item.uri!);
			item.error = undefined;
			this.updateFromContents(controller, content, item);
		} catch (e) {
			item.error = (e as Error).stack;
		}
	}

	/**
	 * Parses the tests from the input text, and updates the tests contained
	 * by this file to be those from the text,
	 */
	public updateFromContents(controller: vscode.TestController, content: string, item: vscode.TestItem) {
		const ancestors = [{ item, children: [] as vscode.TestItem[] }];
		const thisGeneration = generationCounter++;
		this.didResolve = true;

		const ascend = (depth: number) => {
			while (ancestors.length > depth) {
				const finished = ancestors.pop()!;
				finished.item.children.replace(finished.children);
			}
		};

		parseMarkdown(content, {
			onTest: (range, testName) => {
				const parent = ancestors[ancestors.length - 1];
				const data = new NatUnitTest(testName, thisGeneration);
				const id = `${item.uri}/${testName}`;


				const tcase = controller.createTestItem(id, testName, item.uri);
				testData.set(tcase, data);
				tcase.range = range;
				parent.children.push(tcase);
			},
		});

		ascend(0); // finish and assign children for all remaining items
	}
}

export class TestHeading {
	constructor(public generation: number) { }
}

type Operator = '+' | '-' | '*' | '/';

export class NatUnitTest {
    constructor(
        private readonly name: string,
        public generation: number
    ) {}

    getLabel() {
        return this.name;
    }
}

export class TestCase {
	constructor(
		private readonly a: number,
		private readonly operator: Operator,
		private readonly b: number,
		private readonly expected: number,
		public generation: number
	) { }

	getLabel() {
		return `${this.a} ${this.operator} ${this.b} = ${this.expected}`;
	}

	async run(item: vscode.TestItem, options: vscode.TestRun): Promise<void> {
		const start = Date.now();
		await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 1000));
		const actual = this.evaluate();
		const duration = Date.now() - start;

		if (actual === this.expected) {
			options.passed(item, duration);
		} else {
			const message = vscode.TestMessage.diff(`Expected ${item.label}`, String(this.expected), String(actual));
			message.location = new vscode.Location(item.uri!, item.range!);
			options.failed(item, message, duration);
		}
	}

	private evaluate() {
		switch (this.operator) {
			case '-':
				return this.a - this.b;
			case '+':
				return this.a + this.b;
			case '/':
				return Math.floor(this.a / this.b);
			case '*':
				return this.a * this.b;
		}
	}
}