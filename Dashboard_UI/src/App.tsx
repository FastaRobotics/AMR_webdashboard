import { lazy, Suspense } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  Outlet,
} from "react-router";
import { useAuthStore } from "./store/authStore";

const Layout = lazy(() => import("./components/Layout"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const RobotFleet = lazy(() => import("./pages/RobotFleet"));
const RobotConnection = lazy(() => import("./pages/RobotConnection"));
const ManualControl = lazy(() => import("./pages/ManualControl"));
const LiveCamera = lazy(() => import("./pages/LiveCamera"));
const Mapping = lazy(() => import("./pages/Mapping"));
const Navigation = lazy(() => import("./pages/Navigation"));
const MissionControl = lazy(() => import("./pages/MissionControl"));
const Telemetry = lazy(() => import("./pages/Telemetry"));
const SystemMonitor = lazy(() => import("./pages/SystemMonitor"));
const RobotInsights = lazy(() => import("./pages/RobotInsights"));
const SimulationTestBench = lazy(() => import("./pages/SimulationTestBench"));
const StreamingTools = lazy(() => import("./pages/StreamingTools"));
const Login = lazy(() => import("./pages/Login"));

/**
 * Component test benches.
 *
 * They are the only entries that pull in three.js (via the 3D viewers), which is
 * by far the largest dependency in the app. Code-splitting them keeps the
 * operational pages — the ones an operator actually opens — out of that bundle.
 */
const TestImage = lazy(() => import("./pages/TestImage"));
const TestPointCloud = lazy(() => import("./pages/TestPointCloud"));
const TestOdom = lazy(() => import("./pages/TestOdom"));
const TestTF = lazy(() => import("./pages/TestTF"));
const TestTwist = lazy(() => import("./pages/TestTwist"));
const TestOccupancyGrid = lazy(() => import("./pages/TestOccupancyGrid"));
const TestBattery = lazy(() => import("./pages/TestBattery"));
const TestColoredPointCloud = lazy(() => import("./pages/TestColoredPointCloud"));

/** Placeholder while a test-bench chunk is fetched. */
function PageLoading() {
  return (
    <div className="p-6 text-sm text-muted-foreground">Loading viewer…</div>
  );
}

const ProtectedRoute = () => {
  const token = useAuthStore((state) => state.token);

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
};

function App() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Router>
        <Routes>
          {/* Public Route */}
          <Route
            path="/login"
            element={
              <Suspense fallback={<PageLoading />}>
                <Login />
              </Suspense>
            }
          />

          {/* Protected Routes Wrapper */}
          <Route element={<ProtectedRoute />}>
            <Route
              path="/*"
              element={
                <Suspense fallback={<PageLoading />}>
                  <Layout>
                    <Routes>
                      <Route path="/" element={<Dashboard />} />
                      <Route path="/robot-fleet" element={<RobotFleet />} />
                      <Route
                        path="/robot-connection"
                        element={<RobotConnection />}
                      />
                      <Route path="/manual-control" element={<ManualControl />} />
                      <Route path="/telemetry" element={<Telemetry />} />
                      <Route path="/system-monitor" element={<SystemMonitor />} />
                      <Route path="/robot-insights" element={<RobotInsights />} />
                      <Route
                        path="/simulation-test-bench"
                        element={<SimulationTestBench />}
                      />
                      <Route path="/live-camera" element={<LiveCamera />} />
                      <Route path="/streaming-tools" element={<StreamingTools />} />
                      <Route path="/mapping" element={<Mapping />} />
                      <Route path="/navigation" element={<Navigation />} />
                      <Route
                        path="/mission-control"
                        element={<MissionControl />}
                      />
                      <Route path="/test-image" element={<TestImage />} />
                      <Route path="/test-point" element={<TestPointCloud />} />
                      <Route path="/test-odom" element={<TestOdom />} />
                      <Route path="/test-tf" element={<TestTF />} />
                      <Route path="/test-twist" element={<TestTwist />} />
                      <Route
                        path="/test-occupancy"
                        element={<TestOccupancyGrid />}
                      />
                      <Route path="/test-battery" element={<TestBattery />} />
                      <Route
                        path="/test-colored-point"
                        element={<TestColoredPointCloud />}
                      />
                    </Routes>
                  </Layout>
                </Suspense>
              }
            />
          </Route>
        </Routes>
      </Router>
    </div>
  );
}

export default App;
