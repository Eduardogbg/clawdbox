new todos to cleanup post-ralph

- no vitest, we should use bun:test
- `export function createTestContext(name: string): Layer.Layer<any, any, any> {` i think this is causing issues, a lot of type errors cuz our test `program` effects are becoming `<...,...,any>`