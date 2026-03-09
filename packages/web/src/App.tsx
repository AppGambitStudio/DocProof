import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import { RuleSetList } from "./pages/rulesets/RuleSetList";
import { RuleSetDetail } from "./pages/rulesets/RuleSetDetail";
import { RuleSetForm } from "./pages/rulesets/RuleSetForm";
import { JobList } from "./pages/jobs/JobList";
import { JobDetail } from "./pages/jobs/JobDetail";
import { isAuthenticated } from "./lib/auth";

function RequireAuth({ children }: { children: React.ReactElement }) {
  if (!isAuthenticated()) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route path="/" element={<Dashboard />} />
          <Route path="/rulesets" element={<RuleSetList />} />
          <Route path="/rulesets/new" element={<RuleSetForm />} />
          <Route path="/rulesets/:id" element={<RuleSetDetail />} />
          <Route path="/rulesets/:id/edit" element={<RuleSetForm />} />
          <Route path="/jobs" element={<JobList />} />
          <Route path="/jobs/:id" element={<JobDetail />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
