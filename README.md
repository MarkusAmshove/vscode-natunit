# vscode-natunit

[![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/markusamshove.vscode-natunit?color=%2300cc00&label=marketplace%20version)](https://marketplace.visualstudio.com/items?itemName=markusamshove.vscode-natunit)

Test explorer integration for NatUnit in VSCode.

# Prerequisites

For this extension to work (run tests and parse results) it needs a NatUnit version which writes test results to disk in a JUnit XML format.

Additionally, there needs to be a bash script (on Linux) or PowerShell script (on Windows) within the workspace that starts the Natural process and makes sure that the test result file is copied to the expected location.

Both scripts are passed the following parameter in order:

1. `LIBRARY`: The library the testcase resides in
1. `TESTCASE`: The name of the testcase without extension (e.g. `TCSTTEST`
1. `NATPARM`: The NATPARM that the Natural process should be started with
1. `COVERAGE`: Flag if coverage data should be recorded (currently not implemented, preview API of VSCode)

The results are expected to land in the following directory, relative to the workspace (may be configurable in the future):

`build/test-results/natunit/${natparm}/${testFileLibrary}-${testCaseName}.xml`

# Configuration

The extension has the following configurations:

1. `natunit.script.windows`: Relative workspace path to the PowerShell script to run to invoke NatUnit on Windows
1. `natunit.script.linux`: Relative workspace path to the script to run to invoke NatUnit on Linux
1. `natunit.natparms`: Possible NATPARMs to run tests with. Will be passed to the run script.

NATPARMs need to be configured in JSON format, e.g.:

```json
	"natunit.natparms": [
		"NATPARM1",
		"NATPARM2"
	]
```

# Assertion failures

Some assertion failures get parsed and rendered differently in the UI, e.g. `ASSERT-STRING-EQUALS`:

![String equals failure][doc/natunitresult.png)
