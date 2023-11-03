import * as vscode from 'vscode';
import { testRegex } from './parser';
import path = require('path');

export class NatUnitCodeLensProvider implements vscode.CodeLensProvider {
    onDidChangeCodeLenses?: vscode.Event<void> | undefined;

    private codeLenses : vscode.CodeLens[] = [];

    provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.ProviderResult<vscode.CodeLens[]> {
        this.codeLenses = [];

        const filename = path.basename(document.uri.fsPath);
        if (!filename.startsWith("TC") && !filename.endsWith(".NSN")) {
            return this.codeLenses;
        }

        for (let lineNo = 0; lineNo < document.lineCount; lineNo++) {
            const line = document.lineAt(lineNo);
            if (testRegex.exec(line.text)) {
                this.codeLenses.push(...this.createCodeLensForRange(line.range));
            }
        }

        return this.codeLenses;
    }

    resolveCodeLens?(codeLens: vscode.CodeLens, token: vscode.CancellationToken): vscode.ProviderResult<vscode.CodeLens> {
        return codeLens;
    }

    private createCodeLensForRange(range: vscode.Range) : vscode.CodeLens[] {
        return [
            new vscode.CodeLens(range, {
                title: "$(testing-run-icon) Run",
                tooltip: "Run the current test case",
                command: "testing.runCurrentFile"
            }),
        ]
    }
};