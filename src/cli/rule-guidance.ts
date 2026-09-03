export interface RuleGuidance {
  howToFix: string;
  whenNotToUse: string;
}

const GUIDANCE: Record<string, RuleGuidance> = {
  'no-ui-layer-in-server-entry': {
    howToFix:
      'Move the UI import out of the server entry: render the component from a client component, or lift the shared logic into a module that is not a route or server entry.',
    whenNotToUse:
      'A framework that deliberately colocates server logic and view in one entry file (some full-stack file conventions) may not want this boundary.',
  },
  'no-db-client-in-request-entry': {
    howToFix:
      'Route the database access through a service or data-access module instead of importing the DB client directly in the request entry.',
    whenNotToUse:
      'Small apps that intentionally keep data access inline, with no service layer, follow a different but equally valid convention.',
  },
  'no-direct-db-in-request-entry': {
    howToFix:
      'Route the database access through a service or data-access module instead of importing the DB client directly in the request entry.',
    whenNotToUse:
      'Small apps that intentionally keep data access inline, with no service layer, follow a different but equally valid convention.',
  },
};

const FALLBACK: RuleGuidance = {
  howToFix:
    'Remove the forbidden import from the flagged file, or route it through the layer this rule expects.',
  whenNotToUse:
    'If the flagged files are a deliberate exception (infrastructure or generated code), keep the rule but add an ignore for those paths.',
};

export function guidanceFor(ruleName: string): RuleGuidance {
  return GUIDANCE[ruleName] ?? FALLBACK;
}
