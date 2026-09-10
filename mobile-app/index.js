/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import {initializeBuildTimeObservability} from './src/observability';

// Start the native SDK before the React tree mounts so app launch, the first
// Activity and the first network requests are observable. Registration stays
// synchronous, as required by React Native; bootstrap failures remain non-fatal.
initializeBuildTimeObservability().catch(() =>
  console.warn('[MallDemo] RUM bootstrap failed'),
);

AppRegistry.registerComponent(appName, () => App);
