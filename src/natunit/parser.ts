import * as vscode from 'vscode';

const testRegex = /^\s*IF NUTESTP.TEST EQ\s+'(.*?)'/g;
const testDataRegex = /^\s*\/\*\s*@TESTDATA/g;

export const parseTestCase = (text: string, events: {
	onTest(range: vscode.Range, name: string): void;
}) => {
	const lines = text.split('\n');
	let parsesTestData = false;
	let lastTest = undefined;

	for (let lineNo = 0; lineNo < lines.length; lineNo++) {
		const line = lines[lineNo];
		const isTest = testRegex.exec(line);
		const hasTestData = lineNo + 1 < lines.length && testDataRegex.exec(lines[lineNo + 1]);

		if (isTest) {
			const [, testName] = isTest;
			lastTest = testName;
			const range = new vscode.Range(new vscode.Position(lineNo, 0), new vscode.Position(lineNo, isTest[0].length));
			if (!hasTestData) {
				// If the test has test data, the test itself doesn't have to be added.
				// This is because the test name itself won't produce any results. All results of this test will have the data appended.
				events.onTest(range, testName);
			}
			continue;
		}

		const startsTestdata = testDataRegex.exec(line);
		if (startsTestdata) {
			parsesTestData = true;
			continue;
		}

		if (parsesTestData && lastTest && line.trimStart().startsWith("/*") && !line.endsWith("*")) {
			const range = new vscode.Range(new vscode.Position(lineNo, 0), new vscode.Position(lineNo, 0));
			const parameter = line.substring(line.indexOf("*") + 1).trim();
			events.onTest(range, `${lastTest} (${parameter})`)
			continue;
		}

		lastTest = undefined;
		parsesTestData = false;
	}
};