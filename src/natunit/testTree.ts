import { TextDecoder } from 'util';
import * as vscode from 'vscode';
import { parseTestCase } from './parser';
import * as child_process from 'child_process';
import { XMLParser } from 'fast-xml-parser';
import { XmlTestCase, XmlTestSuite } from './xmltestresult';
import * as fsAsync from 'fs/promises';
import { natunitConfig } from './config';

const textDecoder = new TextDecoder('utf-8');

export type NatUnitTestData = NatUnitTestCase | NatUnitTest;

export const testData = new WeakMap<vscode.TestItem, NatUnitTestData>();
export const testToTestCase = new WeakMap<vscode.TestItem, NatUnitTestCase>();

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

export class NatUnitTestCase {
	public didResolve = false
	private tests: vscode.TestItem[] = [];
	public name: string = "";
	public path: string = "";

	public get testsInCase() {
		return this.tests;
	}

	public async updateFromDisk(controller: vscode.TestController, item: vscode.TestItem) {
		try {
			this.path = item.uri!.path;
			this.name = item.uri!.path.split('/').pop()!.replace(".NSN", "");
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

		this.tests = [];
		parseTestCase(content, {
			onTest: (range, testName) => {
				const parent = ancestors[ancestors.length - 1];
				const data = new NatUnitTest(testName, thisGeneration);
				const id = `${item.uri}/${testName}`;


				const tcase = controller.createTestItem(id, testName, item.uri);
				testData.set(tcase, data);
				testToTestCase.set(tcase, this);
				tcase.range = range;
				parent.children.push(tcase);
				this.tests.push(tcase);
			},
		});

		ascend(0); // finish and assign children for all remaining items
	}

	async run(testRun: vscode.TestRun, natparm: string): Promise<void> {
		const splittedPath = this.tests[0].uri?.path.split('/')
		if(!splittedPath) {
			this.tests.forEach(t => testRun.skipped(t));
			return;
		}

		const testCaseName = splittedPath.pop()!.replace(".NSN", "");
		const testFileLibrary = splittedPath[splittedPath.indexOf('Natural-Libraries') + 1];

		(await vscode.workspace.findFiles(`build/test-results/natunit/${natparm}/${testFileLibrary}-${testCaseName}.xml`))
			.forEach(async f => await vscode.workspace.fs.delete(f, {useTrash: false, recursive: false}));

		const workspacePath = vscode.workspace.workspaceFolders![0].uri.fsPath;
		const processStartCommand = process.platform === 'linux'
			? `bash -c " cd ${workspacePath} && ./${natunitConfig.linuxScript} '${testFileLibrary}' '${testCaseName}' '${natparm}'"`
			: `powershell.exe -NoProfile -Command "cd ${workspacePath}; ./${natunitConfig.windowsScript} '${testFileLibrary}' '${testCaseName}' '${natparm}'"`;
		const testProcess = child_process.spawn(processStartCommand, {shell:true});
		let stdOut = "";
        let stdErr = "";
        testProcess.stdout?.on('data', d => stdOut += d.toString());
        testProcess.stderr?.on('data', d => stdErr += d.toString());

		for (let test of this.tests) {
			testRun.started(test);
		}

		await new Promise((resolve, _) => testProcess.on('close', resolve));

		const resultFiles = await vscode.workspace.findFiles(`build/test-results/natunit/${natparm}/${testFileLibrary}-${testCaseName}.xml`);
        for (let resultFile of resultFiles) {
            const suiteResult = await this.parseTestResults(resultFile.fsPath);
            const reportResult = this.extractResults(suiteResult.testcase);

			for (let test of this.tests) {
				const result = reportResult.find(r => r._name === test.label.trim());
				if(!result || result.skipped === '') {
					testRun.skipped(test);
					continue;
				}
                if(result.failure) {
					testRun.failed(test, {
						message: result.failure._message,
						...this.parseFailure(result.failure._message)
					}, result._time);
					continue;
				}
				if(result.error) {
					testRun.errored(test, {
						message: result.error._message,
					});
				}
				testRun.passed(test, result._time * 1000);
			}
        }
	}

	private parseFailure(failureMessage: string) : {actualOutput: string, expectedOutput: string} {
		if(failureMessage.includes("> should be <")) {
			const splittedMessage = failureMessage.split("should be");
			const actualMessagePart = splittedMessage[0];
			const expectedMessagePart = splittedMessage[1];
			const getValuePart = (messagePart: string) => messagePart.substring(messagePart.indexOf("<") + 1, messagePart.lastIndexOf(">"));
			return {
				actualOutput: getValuePart(actualMessagePart),
				expectedOutput: getValuePart(expectedMessagePart)
			}
		}
		return {
			actualOutput: failureMessage,
			expectedOutput: ''
		};
	}

	private async parseTestResults(resultFile: string): Promise<XmlTestSuite> {
        const parser = new XMLParser({ attributeNamePrefix: '_', parseAttributeValue: true, ignoreAttributes: false });
        const xmlContent = await fsAsync.readFile(resultFile, {encoding: 'latin1'});
        const xml = parser.parse(xmlContent);
        return xml.testsuite as XmlTestSuite;
    }

	private extractResults(result: XmlTestCase | XmlTestCase[]) : XmlTestCase[] {
        if(this.areMultipleResults(result)) {
            return result;
        }

        return [result];
    }

    private areMultipleResults(result: XmlTestCase | XmlTestCase[]): result is XmlTestCase[] {
        return (result as XmlTestCase[]).map !== undefined;
    }
}

export class NatUnitTest {
    constructor(
        private readonly name: string,
        public generation: number
    ) {}

    getLabel() {
        return this.name;
    }
}