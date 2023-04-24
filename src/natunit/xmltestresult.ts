export type XmlFailure = { _message: string };
export type XmlTestCase = { _classname: string; _name: string; failure?: XmlFailure; skipped?: string; error?: XmlFailure; _time: number };
export type XmlTestSuite = { _errors: number; _failures: number; _name: string; _skipped: number; _tests: number; "system-err": string; testcase: XmlTestCase[] | XmlTestCase };
