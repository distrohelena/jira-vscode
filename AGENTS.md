# Repository Guidelines

- One class per file.
- Favor C#-style patterns and naming. Keep TypeScript structure close to C# conventions (services, repositories, controllers, DTO-like types) so it reads like a C# codebase.
- Follow C#-style patterns, but keep TypeScript function and method names in camelCase.
- Add JSDoc comments to every class, function and or property. Avoid XML tags. Make sure the code is as easy as possible to be read by humans.
- Comments must be substantive (avoid placeholder text) and explain the role/behavior. All members (fields, properties, methods, constructors) should have comments.
- Order members using standard TypeScript layout (constants/fields, constructors, properties, methods) to keep files predictable.
- Keep comments in JSDoc style (`/** ... */`) for consistency.
- Do not add redundant `public` modifiers; members without an access modifier are assumed public in TypeScript.
- Do not use tuples.
- Follow MVC: keep logic in separate classes (controllers/services/managers) and keep UI classes focused only on presentation and input wiring.
- Do not export empty functions or placeholders without a clear owning class/service; every export must have an explicit owner and real implementation.
- Avoid half-measures that patch broken state; ensure systems are correctly initialized or fix the underlying cause instead of bolting on runtime fixes
- Always implement API endpoints strictly from the official documentation, never from memory
- Never add proactive UI/behavior changes without asking the user first and getting explicit approval.
