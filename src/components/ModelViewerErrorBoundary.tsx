"use client";

/**
 * Error boundary for the in-page <model-viewer>.
 *
 * Why this exists:
 *   On iOS Safari we've observed full-page renderer-process kills
 *   ("A problem repeatedly occurred") when model-viewer tries to
 *   load a GLB whose decoded geometry + texture pressure exceeds
 *   WebKit's tab heap budget. The kill takes the entire page with
 *   it — gallery, breadcrumbs, buy-now button, everything — even
 *   though only one slide actually needed the 3D renderer.
 *
 *   This boundary scopes the blast radius. If <model-viewer> (or
 *   anything inside it: dynamic-import of @google/model-viewer,
 *   three.js DRACOLoader fetch, WebGL context init, the actual
 *   render frame) throws synchronously during render or commit,
 *   we swap to `fallback`. The rest of the page is untouched.
 *
 * Caveats:
 *   • React error boundaries catch render-phase + commit-phase
 *     exceptions only. They DO NOT catch async errors, event-
 *     handler errors, or — crucially — out-of-memory crashes
 *     (the renderer process is gone before any JS exception
 *     fires). On iOS Safari the OOM kill manifests as a hard
 *     reload to "A problem repeatedly occurred" with no JS
 *     interception possible. So this boundary is a partial
 *     defence: it catches the cases where model-viewer's own
 *     internals throw (Draco decode failures, WebGL context
 *     refusals, malformed GLB asset), and is no help against
 *     the OS-level OOM kill — that needs the upload-side
 *     pre-check (lib/admin/glb-budget#checkGlbBudget) to
 *     prevent oversize assets from reaching prod in the first
 *     place. The boundary is the second layer of defence.
 *
 * Class component required: error boundaries can only be expressed
 * as classes today (no hook equivalent). React 19 still adheres
 * to this — see https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary.
 */

import { Component, type ReactNode } from "react";

type Props = {
  /** Subtree whose render-phase / commit-phase errors should be
   *  swapped for `fallback`. Typically <ModelViewer />. */
  children: ReactNode;
  /** What to show in place of `children` after a caught error.
   *  Should match the size + aspect of the original subtree so
   *  the surrounding layout doesn't shift. */
  fallback: ReactNode;
};

type State = {
  hasError: boolean;
};

export default class ModelViewerErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    // Triggered during the render phase the next time this boundary's
    // subtree throws. Returning hasError=true causes React to render
    // the fallback on the next commit.
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // Log to the browser console so a triaging dev can see the
    // failure cause. We deliberately do NOT report to a remote
    // logger here — adding telemetry is a separate decision and
    // this PR is the minimum-viable hot-fix.
    // eslint-disable-next-line no-console
    console.error("[ModelViewer] Failed to render", error, info);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}
