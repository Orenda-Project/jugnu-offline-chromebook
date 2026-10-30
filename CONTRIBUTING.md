# Improving it

Pick an open issue, change the pilot, prove the change on the laptop rig and then on a Chromebook, open a pull request.

## The loop

1. **Run the proxy** against a test Jugnu portal: `UPSTREAM=… node server.mjs`.
2. **Change** `pilot-sw.js`, `cb.html` or `boot.js` (the worker updates itself on the next page load while online).
3. **Prove it on the rig**, network on and then truly off:
   - `node rig/cb-check.mjs <token>`: Get ready on a fresh device, then every link with the network off.
   - `touch OFFLINE && node rig/run-quiz.mjs <code> "<new name>" --keep --offline --new-child`, then
     `rm OFFLINE && node rig/reconnect.mjs <code>`: a new child plays offline, then the answers arrive.
   - `touch OFFLINE && node rig/tour.mjs <token> offline; rm OFFLINE`: storybook, video, number game, reading game.
4. **Prove it on a Chromebook**: by hand (Wi-Fi off, play, Wi-Fi on), or `node device/device-offline.mjs`.
5. **Write down what you saw** in the pull request: the screen the child reached, what was or was not in the
   database before and after reconnecting. "It should work" is not a result.

## Rules

- No secrets, tokens, real children's names or data in commits, issues or screenshots. Use test students.
- Never put a child's Chromebook in developer mode; never cut a test Chromebook's network with its firewall
  (it becomes unreachable). Cut the server instead.
- Measure on the real hardware: these devices are slow (2 cores) and give pages 1366×633.
- One change per pull request; say which issue it closes.
