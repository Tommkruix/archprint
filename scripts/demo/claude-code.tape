Output docs/public/demo/claude-code.gif
Source scripts/demo/settings.tape
Set Height 760
Set TypingSpeed 35ms

Hide
Type `cd "$DEMO_DIR" && sh "$DEMO_ASSETS/agent-setup.sh" && export PS1='$ ' CLAUDE_CODE_HIDE_CWD=1 && clear && claude`
Enter
Sleep 8s
Down
Enter
Sleep 6s
Show

Type "Using archprint, what architecture rules does this repo already follow? Keep it short."
Sleep 500ms
Enter
Sleep 30s

Type "Add a GET /api/users/count route that returns how many users there are. Then check your change with archprint."
Sleep 500ms
Enter
Sleep 60s

Hide
Ctrl+C
Ctrl+C
