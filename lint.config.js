import { evidence } from '@ttsc/evidence';

// Every H2 in docs/spec.md is a requirement. The build fails until a source
// function and a test function each cite it with an @evidence tag.
const spec = {
  type: 'markdown',
  files: ['docs/spec.md'],
  symbol: 'h2',
  noEvidenceExclude: true,
  // Each review carries a fingerprint of the section it checked and expires
  // when that section changes.
  requireReview: true,
};
const evidenceGraph = {
  claims: [
    {
      name: 'source implements every spec section',
      type: 'typescript',
      files: ['src/**/*.ts'],
      symbol: 'function',
      reference: spec,
    },
    {
      name: 'tests verify every spec section',
      type: 'typescript',
      files: ['test/**/*.test.ts'],
      symbol: 'function',
      reference: spec,
    },
  ],
};

export default {
  plugins: { evidence },
  ignores: ['**/node_modules/**', 'dist/**'],
  format: {
    severity: 'error',
    printWidth: 100,
    singleQuote: true,
    trailingComma: 'all',
    semi: true,
    sortImports: {
      order: ['<BUILTIN_MODULES>', '', '<THIRD_PARTY_MODULES>', '', '^[./]'],
    },
    jsDoc: false,
  },
  rules: {
    'no-var': 'error',
    'prefer-const': 'error',
    eqeqeq: 'error',
    curly: 'error',
    'no-debugger': 'error',
    'no-duplicate-imports': 'error',
    'typescript/no-explicit-any': 'error',
    'typescript/no-floating-promises': 'error',
    'typescript/no-non-null-assertion': 'warning',
    'evidence/graph': ['error', evidenceGraph],
    'evidence/review': 'error',
  },
};
