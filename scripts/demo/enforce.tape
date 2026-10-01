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
Sleep 6s

Type "npx archprint wire"
Sleep 300ms
Enter
Sleep 3s

Hide
Type `cp "$DEMO_ASSETS/direct-db-route.ts.txt" app/api/users/route.ts && clear`
Enter
Show

Type "cat app/api/users/route.ts"
Sleep 300ms
Enter
Sleep 3s

Type "npm run -s lint"
Sleep 300ms
Enter
Sleep 6s
