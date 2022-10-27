import * as vscode from 'vscode';
import { TestCase, testData, NatUnitTestFile } from './natunit/testTree';

export async function activate(context: vscode.ExtensionContext) {
	const ctrl = vscode.tests.createTestController('mathTestController', 'Markdown Math');
	context.subscriptions.push(ctrl);

	const runHandler = (request: vscode.TestRunRequest, cancellation: vscode.CancellationToken) => {
		const queue: { test: vscode.TestItem; data: TestCase }[] = [];
		const run = ctrl.createTestRun(request);
		// map of file uris to statements on each line:
		// const coveredLines = new Map</* file uri */ string, (vscode.StatementCoverage | undefined)[]>();

		const discoverTests = async (tests: Iterable<vscode.TestItem>) => {
			for (const test of tests) {
				if (request.exclude?.includes(test)) {
					continue;
				}

				const data = testData.get(test);
				if (data instanceof TestCase) {
					run.enqueued(test);
					queue.push({ test, data });
				} else {
					if (data instanceof NatUnitTestFile && !data.didResolve) {
						await data.updateFromDisk(ctrl, test);
					}

					await discoverTests(gatherTestItems(test.children));
				}

				// if (test.uri && !coveredLines.has(test.uri.toString())) {
				// 	try {
				// 		const lines = (await getContentFromFilesystem(test.uri)).split('\n');
				// 		coveredLines.set(
				// 			test.uri.toString(),
				// 			lines.map((lineText, lineNo) =>
				// 				lineText.trim().length ? new vscode.StatementCoverage(0, new vscode.Position(lineNo, 0)) : undefined
				// 			)
				// 		);
				// 	} catch {
				// 		// ignored
				// 	}
				// }
			}
		};

		const runTestQueue = async () => {
			for (const { test, data } of queue) {
				run.appendOutput(`Running ${test.id}\r\n`);
				if (cancellation.isCancellationRequested) {
					run.skipped(test);
				} else {
					run.started(test);
					await data.run(test, run);
				}

				// const lineNo = test.range!.start.line;
				// const fileCoverage = coveredLines.get(test.uri!.toString());
				// if (fileCoverage) {
				// 	fileCoverage[lineNo]!.executionCount++;
				// }

				run.appendOutput(`Completed ${test.id}\r\n`);
			}

			run.end();
		};

		// run.coverageProvider = {
		// 	provideFileCoverage() {
		// 		const coverage: vscode.FileCoverage[] = [];
		// 		for (const [uri, statements] of coveredLines) {
		// 			coverage.push(
		// 				vscode.FileCoverage.fromDetails(
		// 					vscode.Uri.parse(uri),
		// 					statements.filter((s): s is vscode.StatementCoverage => !!s)
		// 				)
		// 			);
		// 		}

		// 		return coverage;
		// 	},
		// };

		discoverTests(request.include ?? gatherTestItems(ctrl.items)).then(runTestQueue);
	};

	ctrl.refreshHandler = async () => {
		await Promise.all(getWorkspaceTestPatterns().map(({ pattern }) => findInitialFiles(ctrl, pattern)));
	};

	ctrl.createRunProfile('V98ENTW', vscode.TestRunProfileKind.Run, runHandler, true);
	ctrl.createRunProfile('V88ENTW', vscode.TestRunProfileKind.Run, runHandler, true);

	ctrl.resolveHandler = async item => {
		if (!item) {
			context.subscriptions.push(...startWatchingWorkspace(ctrl));
			return;
		}

		const data = testData.get(item);
		if (data instanceof NatUnitTestFile) {
			await data.updateFromDisk(ctrl, item);
		}
	};

	function updateTestNodeForDocument(e: vscode.TextDocument) {
		if (e.uri.scheme !== 'file') {
			return;
		}

		if (!e.uri.path.match('*\.NSN$')) {
			return;
		}

		const { file, data } = getOrCreateFile(ctrl, e.uri);
		data.updateFromContents(ctrl, e.getText(), file);
	}

	for (const document of vscode.workspace.textDocuments) {
		updateTestNodeForDocument(document);
	}

	context.subscriptions.push(
		vscode.workspace.onDidOpenTextDocument(updateTestNodeForDocument),
		vscode.workspace.onDidChangeTextDocument(e => updateTestNodeForDocument(e.document)),
	);
}

function getOrCreateFile(controller: vscode.TestController, uri: vscode.Uri) {
	const existing = controller.items.get(uri.toString());
	if (existing) {
		return { file: existing, data: testData.get(existing) as NatUnitTestFile };
	}

	const file = controller.createTestItem(uri.toString(), uri.path.split('/').pop()!.replace(".NSN", ""), uri);
	controller.items.add(file);

	const data = new NatUnitTestFile();
	testData.set(file, data);

	file.canResolveChildren = true;
	return { file, data };
}

function gatherTestItems(collection: vscode.TestItemCollection) {
	const items: vscode.TestItem[] = [];
	collection.forEach(item => items.push(item));
	return items;
}

function getWorkspaceTestPatterns() {
	if (!vscode.workspace.workspaceFolders) {
		return [];
	}

	return vscode.workspace.workspaceFolders.map(workspaceFolder => ({
		workspaceFolder,
		pattern: new vscode.RelativePattern(workspaceFolder, 'Natural-Libraries/**/TC*.NSN'),
	}));
}

async function findInitialFiles(controller: vscode.TestController, pattern: vscode.GlobPattern) {
	for (const file of await vscode.workspace.findFiles(pattern)) {
		getOrCreateFile(controller, file);
	}
}

function startWatchingWorkspace(controller: vscode.TestController) {
	return getWorkspaceTestPatterns().map(({ workspaceFolder, pattern }) => {
		const watcher = vscode.workspace.createFileSystemWatcher(pattern);

		watcher.onDidCreate(uri => getOrCreateFile(controller, uri));
		watcher.onDidChange(uri => {
			const { file, data } = getOrCreateFile(controller, uri);
			if (data.didResolve) {
				data.updateFromDisk(controller, file);
			}
		});
		watcher.onDidDelete(uri => controller.items.delete(uri.toString()));

		findInitialFiles(controller, pattern);

		return watcher;
	});
}