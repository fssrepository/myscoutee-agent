# Agent instructions

Before project work, load and apply
[the myscoutee-agent instructions](../myscoutee-skills/instructions/projects/myscoutee-agent.md)
and the shared documents they require. Resolve project paths from this repository
root, not from the shared checkout. Current user instructions take precedence.

Use the existing sibling `../myscoutee-skills` checkout. If it is absent, clone it
from this repository root:

```sh
git clone -- https://github.com/fssrepository/myscoutee-skills.git ../myscoutee-skills
```

If that path already exists but the required instructions are missing, report the
problem; do not overwrite it. Do not automatically pull, reset or replace an
existing checkout. A clone failure is a missing-instructions blocker; report it.
