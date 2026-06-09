// Vitest global setup. jest-dom matchers are only meaningful in jsdom-based
// component tests, but importing them here is harmless for node tests and keeps
// a single setup entry point.
import '@testing-library/jest-dom/vitest';
