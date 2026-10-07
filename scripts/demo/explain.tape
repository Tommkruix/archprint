Output docs/public/demo/explain.gif
Source scripts/demo/settings.tape
Set Height 520

Hide
Type `cd "$DEMO_DIR" && export PS1='$ ' && clear`
Enter
Wait@120s /^\$\s*$/
Show

Type "npx archprint explain AP-001 ."
Sleep 300ms
Enter
Wait@120s /^\$\s*$/
Sleep 3s
