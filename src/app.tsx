import { MetaProvider, Title } from "@solidjs/meta";
import { Router } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { Suspense } from "solid-js";
import { Toaster } from "solid-sonner";

import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "solid-sonner/styles.css";
import "./globals.css";

export default function App() {
  return (
    <Router
      root={(props) => (
        <MetaProvider>
          <Title>SlopMotion — OSC Animator</Title>
          <Suspense>{props.children}</Suspense>
          <Toaster theme="dark" position="bottom-center" richColors />
        </MetaProvider>
      )}
    >
      <FileRoutes />
    </Router>
  );
}
