import * as vscode from 'vscode';

const testRegex = /^\s*IF NUTESTP.TEST EQ\s+'(.*?)'/g;

export const parseTestCase = (text: string, events: {
	onTest(range: vscode.Range, name: string): void;
}) => {
	const lines = text.split('\n');

	for (let lineNo = 0; lineNo < lines.length; lineNo++) {
		const line = lines[lineNo];
		const test = testRegex.exec(line);
		if (test) {
			const [, testName] = test;
			const range = new vscode.Range(new vscode.Position(lineNo, 0), new vscode.Position(lineNo, test[0].length));
			events.onTest(range, testName);
			continue;
		}
	}
};