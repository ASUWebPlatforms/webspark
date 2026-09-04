import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as ReactDOMClient from 'react-dom/client';

globalThis.React = React;
// Merge full react-dom (for __DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE)
// with react-dom/client (for createRoot / hydrateRoot).
globalThis.ReactDOM = { ...ReactDOM, ...ReactDOMClient };

// Shim for UMD bundles compiled against React 17/18 that read
// React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.
// In React 19 these internals moved to __CLIENT_INTERNALS (H = dispatcher, A = owner).
const _internals =
  React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
globalThis.React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = {
  ReactCurrentOwner: _internals, // old .ReactCurrentOwner.current = fiber owner
  ReactCurrentDispatcher: _internals, // old .ReactCurrentDispatcher.current = dispatcher
  ReactCurrentBatchConfig: _internals, // old .ReactCurrentBatchConfig.transition
};
