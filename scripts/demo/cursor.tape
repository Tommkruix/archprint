Output docs/public/demo/cursor.gif
Source scripts/demo/settings.tape
Set Height 760
Set TypingSpeed 35ms

Hide
Type `cd "$DEMO_DIR" && sh "$DEMO_ASSETS/agent-setup.sh" && export PS1='$ ' && clear && cursor-agent --model grok-4.7-high --approve-mcps --trust --force`
Enter
Sleep 10s
Show

Type "What architecture rules does this repo already follow? Keep it short."
Sleep 500ms
Enter
Sleep 30s

Type "Add a GET /api/users/count route that returns how many users there are. Then check your change against the repo's architecture rules."
Sleep 500ms
Enter
Sleep 60s

Hide
Ctrl+C
Ctrl+C
