---
name: Stateful capability handoffs
description: Preserving router state and report integrity across orchestration and interrupted validation.
---

When passing selected methods from a stateful provider router into another
orchestrator, bind them to the router instance rather than copying bare method
references.

**Why:** A bare method can compile and pass object-mock tests while failing only
on a real provider path because its internal routing state is accessed through
`this`.

**How to apply:** Test capability projection with a stateful fake whose method
asserts its receiver.