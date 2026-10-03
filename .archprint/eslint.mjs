// archprint eslint rules (generated, self-contained). Regenerate with `archprint generate`; remove with `archprint eject`.
// Adopt it in one line:  import archprint from './.archprint/eslint.mjs';  export default [...archprint];
const SPECS = [
  {
    "name": "no-ui-layer-in-server-entry",
    "roles": [
      "\\.controller\\.ts$",
      "app\\/api\\/.*\\/route\\.tsx?$",
      "(^|\\/)hooks\\.server\\.ts$",
      "app\\/.*\\/actions?\\.ts$",
      "(^|\\/)\\+(page|layout)\\.server\\.ts$",
      "pages\\/api\\/.*\\.tsx?$",
      "(^|\\/)\\+server\\.ts$",
      "(^|\\/)server\\/(api|routes|middleware|plugins)\\/.*\\.ts$",
      "server\\/api\\/routers\\/.*\\.ts$"
    ],
    "markers": [
      "(^|\\/)components(\\/|$)"
    ],
    "ignore": [],
    "message": "A request handler (route, API handler, server action, controller) must not import UI components."
  },
  {
    "name": "no-db-client-in-request-entry",
    "roles": [
      "\\.controller\\.ts$",
      "app\\/api\\/.*\\/route\\.tsx?$",
      "(^|\\/)hooks\\.server\\.ts$",
      "app\\/.*\\/actions?\\.ts$",
      "(^|\\/)\\+(page|layout)\\.server\\.ts$",
      "pages\\/api\\/.*\\.tsx?$",
      "(^|\\/)\\+server\\.ts$",
      "(^|\\/)server\\/(api|routes|middleware|plugins)\\/.*\\.ts$",
      "server\\/api\\/routers\\/.*\\.ts$"
    ],
    "markers": [
      "@prisma\\/(client|adapter-)",
      "drizzle-orm",
      "(^|\\/)typeorm(\\/|$)",
      "(^|\\/)mongoose(\\/|$)",
      "(^|\\/)sequelize(\\/|$)",
      "@mikro-orm\\/",
      "(^|\\/)kysely(\\/|$)",
      "(^|\\/)mongodb(\\/|$)",
      "(^|\\/)pg(\\/|$)",
      "(^|\\/)postgres(\\/|$)",
      "(^|\\/)mysql2(\\/|$)",
      "@planetscale\\/database",
      "@neondatabase\\/serverless",
      "better-sqlite3"
    ],
    "ignore": [],
    "message": "A request handler (route, API handler, server action, controller) must not import the database client directly."
  }
];
const BLOCKS = [
  {
    "files": [
      "**/*.{ts,tsx}"
    ],
    "ignores": [
      "**/*.{test,spec,e2e-spec,e2e}.{ts,tsx}",
      "**/__tests__/**",
      "**/__mocks__/**",
      "**/e2e/**",
      "**/cypress/**",
      "**/playwright/**",
      "**/test/**",
      "**/tests/**",
      "**/cli/**",
      "**/cli.{ts,tsx}",
      "**/scripts/**",
      "**/scripts.{ts,tsx}",
      "**/bin/**",
      "**/bin.{ts,tsx}",
      "**/tools/**",
      "**/tools.{ts,tsx}"
    ],
    "rules": {
      "no-console": "error"
    }
  }
];

function makeRule(spec) {
  const roles = spec.roles.map((source) => new RegExp(source));
  const markers = spec.markers.map((source) => new RegExp(source));
  return {
    meta: { type: 'problem', schema: [], messages: { forbidden: spec.message } },
    create(context) {
      const file = context.filename.replace(/\\/g, '/');
      if (!roles.some((role) => role.test(file))) return {};
      if (spec.ignore.some((path) => file.endsWith(path))) return {};
      return {
        ImportDeclaration(node) {
          if (node.importKind === 'type') return;
          if (markers.some((marker) => marker.test(node.source.value))) {
            context.report({ node, messageId: 'forbidden' });
          }
        },
      };
    },
  };
}

const rules = Object.fromEntries(SPECS.map((spec) => [spec.name, makeRule(spec)]));
const plugin = { rules };
const pluginConfigs = SPECS.map((spec) => ({
  files: ['**/*.{ts,tsx}'],
  plugins: { archprint: plugin },
  rules: { ['archprint/' + spec.name]: 'error' },
}));

export default [{ ignores: ['**/.archprint/**'] }, ...BLOCKS, ...pluginConfigs];
