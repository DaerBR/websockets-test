import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import reactRefreshPlugin from 'eslint-plugin-react-refresh';
import importPlugin from 'eslint-plugin-import';
import jsxA11yPlugin from 'eslint-plugin-jsx-a11y';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';

const extensions = ['.ts', '.tsx', '.d.ts', '.js', '.jsx', '.config.ts'];

export default [
	// Base recommended configs
	js.configs.recommended,

	// Global ignores
	{
		ignores: [
			'dist/**',
			'jest.config.cjs',
			'jest.polyfills.cjs',
			'node_modules/**',
			'.coverage/**',
			'vite.config.ts',
			'vite.config.d.ts',
			'vite-env.d.ts',
			'src/vite-env.d.ts',
		],
	},

	// Configuration files (without TypeScript parser)
	{
		files: ['*.config.js', '*.config.cjs', '*.config.mjs'],
		languageOptions: {
			ecmaVersion: 2020,
			sourceType: 'module',
			globals: {
				...globals.node,
			},
		},
	},

	// Main configuration for all TypeScript and JavaScript files
	{
		files: ['**/*.{ts,tsx}', 'src/**/*.{js,jsx}'],

		languageOptions: {
			parser: tsparser,
			parserOptions: {
				ecmaVersion: 2020,
				sourceType: 'module',
				ecmaFeatures: {
					jsx: true,
				},
				project: ['./tsconfig.json', './tsconfig.node.json'],
			},
			globals: {
				...globals.browser,
				...globals.es2020,
			},
		},

		settings: {
			'import/extensions': extensions,
			react: {
				version: 'detect',
			},
			'import/resolver': {
				node: {
					paths: ['src'],
					extensions: extensions,
				},
			},
		},

		plugins: {
			'@typescript-eslint': tseslint,
			react: reactPlugin,
			'react-hooks': reactHooksPlugin,
			'react-refresh': reactRefreshPlugin,
			import: importPlugin,
			'jsx-a11y': jsxA11yPlugin,
		},

		rules: {
			// ESLint recommended overrides
			...reactPlugin.configs.recommended.rules,
			...reactHooksPlugin.configs.recommended.rules,
			...jsxA11yPlugin.configs.recommended.rules,
			...tseslint.configs.recommended.rules,
			'@typescript-eslint/no-empty-object-type': [
				'error',
				{
					allowInterfaces: 'with-single-extends',
				},
			],

			// TypeScript rules
			'@typescript-eslint/adjacent-overload-signatures': 'error',
			'@typescript-eslint/array-type': ['error', { default: 'array-simple' }],
			'@typescript-eslint/consistent-type-assertions': 'error',
			'@typescript-eslint/member-ordering': [
				'error',
				{
					default: {
						memberTypes: 'never',
						order: 'as-written',
					},
					interfaces: {
						memberTypes: ['signature', 'field', 'constructor', 'method'],
						order: 'alphabetically',
					},
					typeLiterals: {
						memberTypes: ['signature', 'field', 'constructor', 'method'],
						order: 'alphabetically',
					},
				},
			],
			'@typescript-eslint/naming-convention': [
				'error',
				{
					format: ['PascalCase'],
					prefix: ['T'],
					selector: 'typeParameter',
				},
				{
					format: ['PascalCase'],
					selector: 'typeLike',
				},
			],
			'@typescript-eslint/no-array-constructor': 'error',
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-empty-function': 'error',
			'@typescript-eslint/no-empty-interface': ['error', { allowSingleExtends: true }],
			'@typescript-eslint/no-extra-non-null-assertion': 'error',
			'@typescript-eslint/no-inferrable-types': 'error',
			'@typescript-eslint/no-loop-func': 'error',
			'@typescript-eslint/no-loss-of-precision': 'error',
			'@typescript-eslint/no-misused-new': 'error',
			'@typescript-eslint/no-namespace': 'error',
			'@typescript-eslint/no-non-null-asserted-optional-chain': 'error',
			'@typescript-eslint/no-shadow': 'error',
			'@typescript-eslint/no-this-alias': 'error',
			'@typescript-eslint/no-unused-expressions': 'error',
			'@typescript-eslint/no-unused-vars': [
				'error',
				{
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_',
				},
			],
			'@typescript-eslint/no-use-before-define': 'error',
			'@typescript-eslint/prefer-as-const': 'error',
			'@typescript-eslint/prefer-namespace-keyword': 'error',
			'@typescript-eslint/prefer-optional-chain': 'error',
			'@typescript-eslint/prefer-ts-expect-error': 'error',
			'@typescript-eslint/triple-slash-reference': 'error',

			// Core ESLint rules
			'array-callback-return': 'error',
			'arrow-body-style': ['error', 'as-needed'],
			'block-scoped-var': 'error',
			camelcase: [
				'error',
				{
					ignoreGlobals: true,
					properties: 'never',
				},
			],
			'consistent-return': 'error',
			'constructor-super': 'error',
			'dot-notation': 'error',
			'for-direction': 'error',
			'getter-return': 'error',
			'id-denylist': ['error', 'rest', 'msg'],
			'max-params': ['error', 3],
			'no-alert': 'error',
			'no-async-promise-executor': 'error',
			'no-bitwise': 'error',
			'no-case-declarations': 'error',
			'no-class-assign': 'error',
			'no-compare-neg-zero': 'error',
			'no-cond-assign': 'error',
			'no-console': [
				'error',
				{
					allow: ['warn', 'error', 'info', 'debug'],
				},
			],
			'no-const-assign': 'error',
			'no-constant-condition': [
				'error',
				{
					checkLoops: false,
				},
			],
			'no-control-regex': 'error',
			'no-debugger': 'error',
			'no-delete-var': 'error',
			'no-div-regex': 'error',
			'no-dupe-args': 'error',
			'no-dupe-class-members': 'error',
			'no-dupe-else-if': 'error',
			'no-dupe-keys': 'error',
			'no-duplicate-case': 'error',
			'no-else-return': 'error',
			'no-empty': 'error',
			'no-empty-character-class': 'error',
			'no-empty-pattern': 'error',
			'no-ex-assign': 'error',
			'no-extra-boolean-cast': 'error',
			'no-fallthrough': 'error',
			'no-func-assign': 'error',
			'no-global-assign': 'error',
			'no-implicit-coercion': 'error',
			'no-import-assign': 'error',
			'no-inline-comments': 'error',
			'no-inner-declarations': 'error',
			'no-invalid-regexp': 'error',
			'no-irregular-whitespace': 'error',
			'no-labels': 'error',
			'no-lone-blocks': 'error',
			'no-lonely-if': 'error',
			'no-misleading-character-class': 'error',
			'no-negated-condition': 'error',
			'no-new-symbol': 'error',
			'no-obj-calls': 'error',
			'no-octal': 'error',
			'no-param-reassign': 'error',
			'no-plusplus': 'error',
			'no-promise-executor-return': 'error',
			'no-prototype-builtins': 'error',
			'no-redeclare': 'error',
			'no-regex-spaces': 'error',
			'no-return-assign': ['error', 'always'],
			'no-self-assign': 'error',
			'no-self-compare': 'error',
			'no-sequences': 'error',
			'no-setter-return': 'error',
			'no-shadow-restricted-names': 'error',
			'no-sparse-arrays': 'error',
			'no-template-curly-in-string': 'error',
			'no-this-before-super': 'error',
			'no-throw-literal': 'error',
			'no-undef': 'error',
			'no-underscore-dangle': 'error',
			'no-unneeded-ternary': 'error',
			'no-unreachable': 'error',
			'no-unreachable-loop': 'error',
			'no-unsafe-finally': 'error',
			'no-unsafe-negation': 'error',
			'no-unsafe-optional-chaining': 'error',
			'no-unused-labels': 'error',
			'no-useless-catch': 'error',
			'no-useless-computed-key': 'error',
			'no-useless-escape': 'error',
			'no-useless-rename': 'error',
			'no-var': 'error',
			'no-void': 'error',
			'no-with': 'error',
			'object-shorthand': 'error',
			'one-var': ['error', 'never'],
			'padding-line-between-statements': [
				'error',
				{
					blankLine: 'always',
					next: ['block', 'block-like', 'export', 'import', 'return', 'throw'],
					prev: '*',
				},
				{
					blankLine: 'any',
					next: ['export', 'import'],
					prev: ['export', 'import'],
				},
				{
					blankLine: 'never',
					next: '*',
					prev: 'case',
				},
			],
			'prefer-arrow-callback': 'error',
			'prefer-const': [
				'error',
				{
					ignoreReadBeforeAssign: true,
				},
			],
			'prefer-exponentiation-operator': 'error',
			'prefer-regex-literals': 'error',
			'prefer-rest-params': 'error',
			'prefer-spread': 'error',
			'prefer-template': 'error',
			'require-atomic-updates': 'error',
			'require-yield': 'error',
			'sort-imports': [
				'error',
				{
					ignoreCase: false,
					ignoreDeclarationSort: true,
					ignoreMemberSort: false,
					memberSyntaxSortOrder: ['none', 'all', 'multiple', 'single'],
				},
			],
			'spaced-comment': 'error',
			'use-isnan': 'error',
			'valid-typeof': 'error',

			// Import rules
			'import/default': 'error',
			'import/export': 'error',
			'import/first': ['error', 'absolute-first'],
			'import/namespace': 'error',
			'import/newline-after-import': 'error',
			'import/no-absolute-path': 'error',
			'import/no-amd': 'error',
			'import/no-duplicates': 'error',
			'import/no-mutable-exports': 'error',
			'import/no-named-as-default-member': 'error',
			'import/no-named-default': 'error',
			'import/no-self-import': 'error',

			// React hooks rules
			'react-hooks/exhaustive-deps': 'error',
			'react-hooks/rules-of-hooks': 'error',
			'react-hooks/set-state-in-effect': 'off',

			// React rules
			'react/jsx-boolean-value': ['error', 'never'],
			'react/jsx-curly-brace-presence': [
				'error',
				{
					children: 'ignore',
					propElementValues: 'always',
					props: 'never',
				},
			],
			'react/jsx-filename-extension': [
				'error',
				{
					extensions: ['.tsx', '.jsx'],
				},
			],
			'react/jsx-handler-names': 'off',
			'react/jsx-no-comment-textnodes': 'error',
			'react/jsx-no-constructed-context-values': 'error',
			'react/jsx-no-duplicate-props': 'error',
			'react/jsx-no-target-blank': 'error',
			'react/jsx-no-undef': 'error',
			'react/jsx-no-useless-fragment': [
				'error',
				{
					allowExpressions: true,
				},
			],
			'react/jsx-pascal-case': 'error',
			'react/jsx-uses-react': 'error',
			'react/jsx-uses-vars': 'error',
			'react/no-children-prop': 'error',
			'react/no-danger': 'error',
			'react/no-danger-with-children': 'error',
			'react/no-deprecated': 'error',
			'react/no-did-mount-set-state': 'error',
			'react/no-did-update-set-state': 'error',
			'react/no-direct-mutation-state': 'error',
			'react/no-find-dom-node': 'error',
			'react/no-is-mounted': 'error',
			'react/no-render-return-value': 'error',
			'react/no-string-refs': 'error',
			'react/no-typos': 'error',
			'react/no-unescaped-entities': 'error',
			'react/no-unknown-property': [
				'error',
				{
					ignore: ['css'],
				},
			],
			'react/no-unstable-nested-components': 'error',
			'react/prefer-es6-class': 'error',
			'react/prefer-stateless-function': 'error',
			'react/react-in-jsx-scope': 'off',
			'react/require-render-return': 'error',
			'react/self-closing-comp': 'error',
			'react/sort-prop-types': 'error',
			'react/style-prop-object': 'error',
			'react/void-dom-elements-no-children': 'error',

			// Prettier config to disable conflicting rules
			...prettierConfig.rules,
		},
	},

	// Test files configuration
	{
		files: ['**/*.test.{ts,tsx}', '**/__tests__/**/*.{ts,tsx}'],
		languageOptions: {
			globals: {
				...globals.jest,
			},
		},
	},
];
