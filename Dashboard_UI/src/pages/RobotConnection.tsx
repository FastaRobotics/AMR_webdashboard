import { useMemo, useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Badge } from "../components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { AlertCircle, Circle, Loader2, Plug, Power, RefreshCw } from "lucide-react";
import { cn } from "../components/ui/utils";
import { useFleet } from "../hooks/useFleet";
import { useRobotStream } from "../hooks/useRobotStream";
import {
  apiErrorMessage,
  connectRobot,
  disconnectRobot,
  getRobotConnectionStatus,
} from "../api/routes";
import { useRobotStore, ROBOT_ENDPOINTS } from "../store/robotStore";
import type { DiagnosticLevel, DiagnosticStatus } from "../api/types";

/** Service health comes from the `diagnostics` ROS topic (no REST equivalent). */

const LEVEL_CONFIG: Record<DiagnosticLevel, { label: string; badge: string }> = {
  0: { label: "Running", badge: "bg-green-500" },
  1: { label: "Warning", badge: "bg-yellow-500" },
  2: { label: "Error", badge: "bg-red-500" },
  3: { label: "Stale", badge: "bg-gray-500" },
};

export default function RobotConnection() {
  const {
    robots,
    selectedRobotId,
    connectionStatus,
    isLoading,
    error: fleetError,
    refresh,
    selectRobot,
  } = useFleet();

  /** rosbridge address; pre-filled from ROBOT_ENDPOINTS for the selection. */
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");

  useEffect(() => {
    if (!selectedRobotId) {
      setHost("");
      setPort("");
      return;
    }

    const endpoint = ROBOT_ENDPOINTS[selectedRobotId];
    setHost(endpoint?.host ?? "");
    setPort(endpoint ? String(endpoint.port) : "");
  }, [selectedRobotId]);

  const [isConnecting, setIsConnecting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const setConnectionStatus = useRobotStore(
    (state) => state.setConnectionStatus,
  );

  const isConnected = selectedRobotId
    ? (connectionStatus[selectedRobotId] ?? false)
    : false;

  const {
    data: diagnosticsData,
    isConnected: diagnosticsConnected,
    error: diagnosticsError,
  } = useRobotStream({
    robotId: selectedRobotId,
    topic: "diagnostics",
    // Only worth subscribing once the robot is actually reachable.
    autoConnect: isConnected,
  });

  const diagnostics: DiagnosticStatus[] = useMemo(
    () => diagnosticsData?.diagnostics?.status ?? [],
    [diagnosticsData],
  );

  const runAction = async (action: "connect" | "disconnect") => {
    if (!selectedRobotId) return;

    setIsConnecting(true);
    setActionError(null);

    const robotId = selectedRobotId;

    try {
      if (action === "connect") {
        const parsedPort = port.trim() ? Number(port) : undefined;

        // Always send the address: the endpoint's 0.0.0.0 default would
        // override the robot's configured IP on the backend.
        await connectRobot(robotId, host.trim() || undefined, parsedPort);
      } else {
        await disconnectRobot(robotId);
      }
    } catch (err) {
      setActionError(apiErrorMessage(err));
    } finally {
      // Re-read just this robot's state; the fleet list has not changed.
      try {
        setConnectionStatus(await getRobotConnectionStatus(robotId));
      } catch {
        setActionError("Could not refresh connection status.");
      }
      setIsConnecting(false);
    }
  };

  return (
    <div className="p-6 pb-28 space-y-6">
      <div>
        <h1 className="text-3xl font-bold mb-2">Robot Connection</h1>
        <p className="text-muted-foreground">
          Manage robot connections and monitor system diagnostics
        </p>
      </div>

      {(fleetError || actionError) && (
        <Card className="border-red-500/50">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-500 mt-0.5" />
            <div className="text-sm">{actionError ?? fleetError}</div>
          </CardContent>
        </Card>
      )}

      {/* Connection Control */}
      <Card>
        <CardHeader>
          <CardTitle>Robot Selection & Connection</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <div>
              <Label className="mb-2 block">Select Robot</Label>
              <Select
                value={selectedRobotId ?? ""}
                onValueChange={selectRobot}
                disabled={isLoading || robots.length === 0}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      isLoading ? "Loading robots..." : "Choose a robot"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {robots.map((robot) => (
                    <SelectItem key={robot.id} value={robot.id}>
                      {robot.id} ({robot.type})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="rosbridge-host" className="mb-2 block">
                rosbridge Host{" "}
                <span className="text-muted-foreground font-normal">
                  (optional)
                </span>
              </Label>
              <Input
                id="rosbridge-host"
                placeholder="use the robot's configured IP"
                value={host}
                onChange={(event) => setHost(event.target.value)}
                disabled={isConnecting || isConnected}
              />
            </div>

            <div>
              <Label htmlFor="rosbridge-port" className="mb-2 block">
                Port{" "}
                <span className="text-muted-foreground font-normal">
                  (optional)
                </span>
              </Label>
              <Input
                id="rosbridge-port"
                type="number"
                placeholder="9090"
                value={port}
                onChange={(event) => setPort(event.target.value)}
                disabled={isConnecting || isConnected}
              />
            </div>
          </div>

          <div className="flex items-center space-x-3 p-4 bg-muted rounded-lg">
            {isConnecting ? (
              <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
            ) : (
              <Circle
                className={cn(
                  "w-5 h-5",
                  isConnected
                    ? "fill-green-500 text-green-500"
                    : "fill-red-500 text-red-500",
                )}
              />
            )}
            <div>
              <div className="font-medium">
                {robots.find((robot) => robot.id === selectedRobotId)?.id ??
                  "No robot selected"}
              </div>
              <div className="text-sm text-muted-foreground">
                {isConnecting
                  ? "Working..."
                  : isConnected
                    ? "Connected"
                    : "Disconnected"}
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              onClick={() => void runAction("connect")}
              disabled={isConnecting || isConnected || !selectedRobotId}
              className="flex-1"
            >
              {isConnecting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  <Plug className="w-4 h-4 mr-2" />
                  Connect
                </>
              )}
            </Button>

            <Button
              onClick={() => void runAction("disconnect")}
              variant="outline"
              className="flex-1"
              disabled={isConnecting || !isConnected}
            >
              <Power className="w-4 h-4 mr-2" />
              Disconnect
            </Button>

            <Button
              onClick={() => void refresh()}
              variant="outline"
              disabled={isLoading}
            >
              <RefreshCw
                className={cn("w-4 h-4", isLoading && "animate-spin")}
              />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Diagnostics Table — streamed from the robot's diagnostics topic */}
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center justify-between gap-2">
            System Diagnostics
            <Badge
              variant="secondary"
              className={cn(
                "text-xs",
                diagnosticsConnected
                  ? "bg-green-500 text-white"
                  : "bg-gray-500 text-white",
              )}
            >
              {diagnosticsConnected ? "Live" : "Not streaming"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {diagnostics.length === 0 ? (
            <div className="text-sm text-muted-foreground p-2">
              {diagnosticsError
                ? diagnosticsError
                : isConnected
                  ? "Waiting for the first diagnostics message from the robot..."
                  : "Connect the robot to stream diagnostics."}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Service Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead>Hardware ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {diagnostics.map((service) => {
                  const config = LEVEL_CONFIG[service.level] ?? LEVEL_CONFIG[3];
                  return (
                    <TableRow key={service.name}>
                      <TableCell className="font-medium">
                        {service.name}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={cn("text-white", config.badge)}
                        >
                          {config.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {service.message || "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {service.hardware_id || "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
