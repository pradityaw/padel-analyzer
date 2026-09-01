import { useEffect } from "react";
import { Redirect, Route, Switch, useLocation } from "wouter";
import Upload from "./pages/Upload";
import Analysis from "./pages/Analysis";
import History from "./pages/History";
import Compare from "./pages/Compare";
import Annotate from "./pages/Annotate";
import ProCompare from "./pages/ProCompare";
import Welcome from "./pages/Home";
import Login from "./pages/Login";
import Privacy from "./pages/Privacy";
import AppHeader from "./components/AppHeader";
import FloatingNav from "./components/ui/FloatingNav";
import { trpc } from "@/lib/trpc";

function WelcomeGuard() {
  const [, navigate] = useLocation();
  const session = trpc.auth.getSession.useQuery(undefined, { retry: false });

  useEffect(() => {
    if (!session.data) return;
    if (session.data.authMode === "on" && session.data.user) {
      navigate("/app");
    }
  }, [session.data, navigate]);

  // Show the marketing page immediately; redirect signed-in users when session resolves.
  return <Welcome />;
}

function AppShell() {
  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <AppHeader />
      <main className="flex-1 pb-24">
        <Switch>
          <Route path="/" component={History} />
          <Route path="/upload" component={Upload} />
          <Route path="/analysis/:id" component={Analysis} />
          <Route path="/compare" component={Compare} />
          <Route path="/pro-compare" component={ProCompare} />
          <Route path="/annotate" component={Annotate} />
        </Switch>
      </main>
      <FloatingNav />
    </div>
  );
}

export default function App() {
  return (
    <Switch>
      <Route path="/" component={WelcomeGuard} />
      <Route path="/login" component={Login} />
      <Route path="/privacy" component={Privacy} />
      <Route path="/sessions">
        <Redirect to="/app" />
      </Route>
      <Route path="/upload">
        <Redirect to="/app/upload" />
      </Route>
      <Route path="/compare">
        <Redirect to="/app/compare" />
      </Route>
      <Route path="/annotate">
        <Redirect to="/app/annotate" />
      </Route>
      <Route path="/pro-compare">
        <Redirect to="/app/pro-compare" />
      </Route>
      <Route path="/analysis/:id">
        {(params) => <Redirect to={`/app/analysis/${params.id}`} />}
      </Route>
      <Route path="/app" nest>
        <AppShell />
      </Route>
    </Switch>
  );
}

