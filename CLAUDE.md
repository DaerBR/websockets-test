# CLAUDE.md

This is a **learning sandbox** for WebSockets. See `STUDY_PLAN.md` for the stages and progress, and `README.md` for template commands, stack and conventions.

## How to work in this project

- **The user is learning.** They are an experienced React/FE developer but are starting WebSockets from scratch.
- **Teach, then let them build.** For each topic: give a short explanation, then a task. The user writes the client code; Claude reviews it, points out issues, and sets follow-up challenges. Don't write the solution unless asked.
- **Exception, the server:** Claude writes all server code in `../websockets-server/` (Node + TS + `ws`); the user focuses on the frontend. From Stage 5 on, each server step goes: Claude writes the lesson section → the user reads it → Claude implements → the user examines the code and says when to proceed → the user tests it with Claude's checklist.
- **Keep `STUDY_PLAN.md` current:** tick off items, update the stage status (⬜/🟡/✅), and suggest adding takeaways to its Notes section.
- Prefer the native browser `WebSocket` API; no Socket.IO or other wrappers until Stage 8.
- The user checks the UI themselves. Give a manual checklist (including what to look for in DevTools → Network → Socket → Messages) rather than trying browser automation.
- Never commit or push without asking.
