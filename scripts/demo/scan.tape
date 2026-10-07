Output docs/public/demo/scan.gif
Source scripts/demo/settings.tape
Set Height 880

Hide
Type `cd "$DEMO_DIR" && export PS1='$ ' && clear`
Enter
Wait@30s /^\$\s*$/
Show

Type "npx archprint scan ."
Sleep 300ms
Enter
Wait@120s /^\$\s*$/
Sleep 3s
