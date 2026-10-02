Output docs/public/demo/cursor.gif
Source scripts/demo/settings.tape
Set Height 760
Set TypingSpeed 35ms

Hide
Type `cd "$DEMO_DIR" && export PS1='$ ' && clear && cursor-agent --model grok-4.7-high --approve-mcps --trust`
Enter
Sleep 8s
Show

Type "What architecture rules does this repo already follow? Keep it short."
Sleep 500ms
Enter
Wait+Screen@90s /Run this MCP tool/
Sleep 1500ms
Type "y"
Sleep 20s

Hide
Ctrl+C
Ctrl+C
