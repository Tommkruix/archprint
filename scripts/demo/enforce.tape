Output docs/public/demo/enforce.gif
Source scripts/demo/settings.tape
Set Height 760

Hide
Type `cd "$DEMO_DIR" && export PS1='$ ' && clear`
Enter
Show

Type "npx archprint init"
Sleep 300ms
Enter
Sleep 5s

Type "ls .archprint"
Enter
Sleep 2s

Hide
Type "clear"
Enter
Show

Type "npx archprint wire && git diff eslint.config.mjs"
Sleep 300ms
Enter
Sleep 4s

Hide
Type `cp "$DEMO_ASSETS/direct-db-route.ts.txt" app/api/users/route.ts && clear`
Enter
Show

Type "cat app/api/users/route.ts"
Enter
Sleep 2500ms

Type "npm run -s lint"
Sleep 300ms
Enter
Sleep 5s

Hide
Type "git checkout -q -- app/api/users/route.ts && clear"
Enter
Show

Type "npx archprint eject && git status --short"
Sleep 300ms
Enter
Sleep 4s
