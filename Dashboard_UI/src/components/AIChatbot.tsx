import React, { useMemo, useState, useRef, useEffect } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Card, CardHeader, CardTitle } from "./ui/card";
import { Avatar, AvatarFallback } from "./ui/avatar";
import {
  Bot,
  Send,
  X,
  Minimize2,
  Maximize2,
  Sparkles,
  User,
} from "lucide-react";
import { cn } from "./ui/utils";
import { useRobotStore, useSelectedRobot } from "../store/robotStore";
import { useFleet } from "../hooks/useFleet";
import { useRobotState } from "../hooks/useRobotState";

interface Message {
  id: string;
  content: string;
  sender: "user" | "ai";
  timestamp: Date;
}

interface AIChatbotProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Operations assistant.
 *
 * There is no language model behind this: it is a keyword-matched help panel.
 * What it *does* do honestly is answer status questions from the live store and
 * the backend's robot state, instead of quoting canned numbers — so "robot
 * status" reports the fleet you are actually looking at.
 */
export default function AIChatbot({ isOpen, onClose }: AIChatbotProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      content:
        "Hi! I can explain this dashboard, report live robot status, and walk you through diagnostics, manual control, mapping, navigation and recording. Ask away — or use a shortcut below.",
      sender: "ai",
      timestamp: new Date(),
    },
  ]);
  const [inputValue, setInputValue] = useState("");
  const [isMinimized, setIsMinimized] = useState(false);
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset minimized state when the chatbot opens — during render, not in an effect.
  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen);
    if (isOpen) {
      setIsMinimized(false);
    }
  }

  const selectedRobotId = useRobotStore((state) => state.selectedRobotId);
  const selectedRobot = useSelectedRobot();
  const connectionStatus = useRobotStore((state) => state.connectionStatus);
  const robots = useRobotStore((state) => state.robots);

  // Keeps the assistant's answers current even on pages that do not poll.
  const { isRefreshing } = useFleet({ pollIntervalMs: 10000 });
  const { state: robotState, unavailable } = useRobotState(selectedRobotId, {
    pollIntervalMs: 5000,
  });

  const connected = selectedRobotId
    ? (connectionStatus[selectedRobotId] ?? false)
    : false;

  const liveStatus = useMemo(() => {
    if (!selectedRobot) return "No robot is selected right now.";

    const lines = [
      `Robot: ${selectedRobot.id} (${selectedRobot.type})`,
      `Connection: ${connected ? "connected to its rosbridge" : "not connected"}`,
    ];

    if (robotState) {
      lines.push(
        `Task: ${robotState.task ?? "idle"}`,
        `Pose: x ${robotState.pose.x.toFixed(2)}, y ${robotState.pose.y.toFixed(2)}, yaw ${robotState.pose.yaw.toFixed(2)} rad`,
        `Battery: ${(robotState.battery.percentage * 100).toFixed(0)}% (${robotState.battery.voltage.toFixed(1)} V, ${robotState.battery.temperature.toFixed(0)} °C)`,
        `Map: ${(robotState.map.mapped_ratio * 100).toFixed(0)}% known, revision ${robotState.map.revision}${robotState.map.loaded_map ? `, loaded "${robotState.map.loaded_map}"` : ""}`,
      );

      if (robotState.goal_text && robotState.goal_text !== "none") {
        lines.push(
          `Goal: ${robotState.goal_text}, ${robotState.distance_remaining_m.toFixed(2)} m remaining`,
        );
      }
      if (robotState.emergency_stopped) lines.push("EMERGENCY STOP is engaged.");
      if (robotState.recording.active) {
        lines.push(`Recording rosbag "${robotState.recording.rosbag_name}".`);
      }
      lines.push(`Simulated clock: ${robotState.sim_time.toFixed(1)} s`);
    } else if (unavailable) {
      lines.push(
        "This backend exposes no robot-state endpoint, so live telemetry is not readable from here.",
      );
    } else if (!connected) {
      lines.push(
        "Connect the robot on the Robot Connection page to see live telemetry.",
      );
    } else {
      lines.push("Waiting for the first state sample from the backend.");
    }

    return lines.join("\n");
  }, [connected, robotState, selectedRobot, unavailable]);

  const fleetStatus = useMemo(() => {
    const online = robots.filter((robot) => connectionStatus[robot.id]);
    if (robots.length === 0) {
      return "The backend reports no registered robots.";
    }
    return [
      `Registered robots: ${robots.length}`,
      `Connected: ${online.length}${online.length ? ` (${online.map((r) => r.id).join(", ")})` : ""}`,
      `Offline: ${robots.length - online.length}`,
    ].join("\n");
  }, [connectionStatus, robots]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

  useEffect(() => {
    if (isOpen && !isMinimized) {
      const timer = window.setTimeout(() => inputRef.current?.focus(), 100);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [isOpen, isMinimized]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isOpen) onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  /**
   * Help topics, phrased against the endpoints this dashboard really calls.
   * Anything that invents a number was removed on purpose — the assistant may
   * be out of date, but it must not be wrong about the robot's state.
   */
  const getAIResponse = (userMessage: string): string => {
    const text = userMessage.toLowerCase();

    const has = (...words: string[]) => words.some((word) => text.includes(word));

    if (has("fleet", "robot list", "how many")) return fleetStatus;
    if (has("status", "state", "battery", "pose", "where is"))
      return liveStatus;

    if (has("camera", "video", "webrtc", "stream"))
      return [
        "Live video comes from the backend's WebRTC relay:",
        "• POST /streaming/offer/browser negotiates one track per source;",
        "• GET /streaming/status reports connected peers and source tracks;",
        "• the fake backend injects a synthetic camera track on amr_1.",
        "If the feed says the track count is 0, no robot (or synthetic source) is publishing a camera. If signalling returns 501, aiortc is not installed in the backend environment.",
      ].join("\n");

    if (has("record", "rosbag", "bag"))
      return [
        "Recording uses the rosbag endpoints on the selected robot:",
        "• POST /recording/{robot}/start takes a bare JSON string name;",
        "• POST /recording/{robot}/status lists the bags and the running one;",
        "• DELETE /recording/{robot}/{name} removes a bag.",
        "Open Live Camera for the controls and the bag library. A 500 usually means the robot is not connected, or (on go2_1) that the robot exposes no recording service.",
      ].join("\n");

    if (has("map", "slam", "mapping"))
      return [
        "Mapping:",
        "• Start Mapping calls POST /mapping/{robot}/start and puts the robot in its SLAM session;",
        "• the full occupancy grid streams over WS /streaming_socket/{robot}/ws/subscribe/map at 2 Hz; odometry remains at 10 Hz;",
        "• Stop Mapping saves the current map under a name (map_name in the JSON body);",
        "• DELETE /mapping/{robot}/delete takes map_name in the body.",
        "go2_1 has no map topic at all — its map socket answers with an error frame instead of streaming.",
      ].join("\n");

    if (has("navigat", "goal", "waypoint", "path", "explor"))
      return [
        "Navigation:",
        "• POST /navigation/{robot}/start_with_map loads a saved map and localises;",
        "• POST /navigation/{robot}/exploring/start runs frontier exploration;",
        "• goals are published on the goal_pose topic and the plan streams on the path socket;",
        "• POST /navigation/{robot}/stop cancels.",
        "Saved waypoints come from the backend's waypoint list. go2_1 exposes no start_with_map service.",
      ].join("\n");

    if (has("emergency", "e-stop", "estop", "stop"))
      return [
        "Emergency stop publishes true/false on the robot's emergency_stop topic:",
        "POST /navigation/{robot}/emergency_stop/{activate|deactivate}.",
        "The button in the status bar toggles it; the current engagement is shown on the Dashboard and in the status tooltip.",
      ].join("\n");

    if (has("connect", "offline", "unreachable", "network"))
      return [
        "Connection troubleshooting:",
        "• the fleet list and per-robot status come from /connection/*;",
        "• Connect posts the rosbridge host and port to /connection/{robot}/connect;",
        "• a 500 with 'Failed to connect to ROS at …' means the rosbridge socket was refused;",
        "• status is re-read right after the action, so the badge always reflects the backend.",
        "If every page reports 401, the stored token no longer matches the backend's SECRET_KEY — log in again.",
      ].join("\n");

    if (has("manual", "joystick", "teleop", "twist", "drive"))
      return [
        "Manual control streams twist commands over the control socket:",
        "ws /control_socket/robots/{robot}/ws/publish/twist with",
        '{"type":"twist","data":{"linear":0.4,"angular":0.0}}.',
        "Start Control opens it, Stop Control sends a zero twist first and then closes it. The backend's deadman switch zeroes the base if commands stop arriving.",
      ].join("\n");

    if (has("error", "problem", "issue", "fail", "help"))
      return [
        "I can help with:",
        "• robot status and the fleet list",
        "• connection and unreachable-host failures",
        "• manual control / teleoperation",
        "• mapping, navigation and waypoints",
        "• camera / WebRTC and rosbag recording",
        "• emergency stop",
        "Ask about one of those, or paste the error message you see.",
      ].join("\n");

    if (has("thank")) return "You're welcome. Anything else you want checked?";

    return [
      "I do not have an answer for that one. I can help with:",
      "• status and battery for the selected robot",
      "• how many robots are connected",
      "• mapping, navigation, waypoints",
      "• camera / video streaming",
      "• rosbag recording",
      "• emergency stop and connection failures",
    ].join("\n");
  };

  const handleSendMessage = () => {
    if (!inputValue.trim()) return;

    const userMessage: Message = {
      id: `${Date.now()}`,
      content: inputValue,
      sender: "user",
      timestamp: new Date(),
    };

    const messageToProcess = inputValue;
    setMessages((prev) => [...prev, userMessage]);
    setInputValue("");
    setIsTyping(true);

    window.setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now() + 1}`,
          content: getAIResponse(messageToProcess),
          sender: "ai",
          timestamp: new Date(),
        },
      ]);
      setIsTyping(false);
    }, 250);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSendMessage();
    }
  };

  const quickActions = [
    { label: "Robot status", value: "robot status" },
    { label: "Fleet", value: "fleet" },
    { label: "Camera help", value: "camera" },
    { label: "Recording", value: "recording" },
  ];

  if (!isOpen) return null;

  return (
    <div
      className={cn(
        "fixed z-50 inset-x-0 bottom-0",
        "sm:inset-x-auto sm:bottom-20 sm:right-6 sm:w-[22rem] md:w-[24rem]",
        "animate-scale-in",
      )}
    >
      <Card
        className={cn(
          "flex flex-col overflow-hidden border border-border bg-card shadow-2xl",
          "rounded-t-2xl rounded-b-none sm:rounded-2xl",
          isMinimized
            ? "h-auto"
            : cn(
              "h-[80dvh] max-h-[calc(100dvh-1rem)]",
              "sm:h-[600px] sm:max-h-[calc(100dvh-7rem)]",
            ),
        )}
      >
        {/* Header */}
        <CardHeader className="flex-shrink-0 !space-y-0 !p-3 bg-gradient-primary text-white sm:!p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-center space-x-3">
              <div className="relative flex-shrink-0">
                <Avatar className="h-8 w-8 border-2 border-white/20">
                  <AvatarFallback className="bg-white/20 text-white">
                    <Bot className="h-4 w-4" />
                  </AvatarFallback>
                </Avatar>
                <div
                  className={cn(
                    "absolute -right-1 -top-1 h-3 w-3 rounded-full ring-2 ring-white/40",
                    isRefreshing ? "animate-ping bg-yellow-300" : "bg-green-400",
                  )}
                />
              </div>
              <div className="min-w-0 flex-1">
                <CardTitle className="truncate text-sm font-medium leading-tight">
                  Operations Assistant
                </CardTitle>
                <p className="truncate text-xs text-white/80 leading-tight">
                  Live status &amp; how-to help
                </p>
              </div>
            </div>

            {/* Action buttons — always visible, solid backgrounds */}
            <div className="flex flex-shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setIsMinimized((v) => !v)}
                aria-label={isMinimized ? "Maximize" : "Minimize"}
                title={isMinimized ? "Maximize" : "Minimize"}
                className={cn(
                  "inline-flex h-8 w-8 items-center justify-center rounded-full",
                  "bg-white text-slate-700 shadow-md",
                  "transition-transform hover:scale-105 hover:bg-white",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-transparent",
                )}
              >
                {isMinimized ? (
                  <Maximize2 className="h-4 w-4" strokeWidth={2.25} />
                ) : (
                  <Minimize2 className="h-4 w-4" strokeWidth={2.25} />
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsMinimized(false);
                  onClose();
                }}
                aria-label="Close"
                title="Close"
                className={cn(
                  "inline-flex h-8 w-8 items-center justify-center rounded-full",
                  "bg-white text-slate-700 shadow-md",
                  "transition-transform hover:scale-105 hover:bg-red-500 hover:text-white",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-transparent",
                )}
              >
                <X className="h-4 w-4" strokeWidth={2.75} />
              </button>
            </div>
          </div>
        </CardHeader>

        {!isMinimized && (
          <>
            {/* Messages */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4">
              <div className="space-y-4">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={cn(
                      "flex items-start space-x-2",
                      message.sender === "user" &&
                      "flex-row-reverse space-x-reverse",
                    )}
                  >
                    <Avatar className="mt-1 h-6 w-6 flex-shrink-0">
                      <AvatarFallback
                        className={cn(
                          "text-xs",
                          message.sender === "ai"
                            ? "bg-cyan-500 text-white"
                            : "bg-muted text-foreground",
                        )}
                      >
                        {message.sender === "ai" ? (
                          <Bot className="h-3 w-3" />
                        ) : (
                          <User className="h-3 w-3" />
                        )}
                      </AvatarFallback>
                    </Avatar>
                    <div
                      className={cn(
                        "max-w-[85%] rounded-2xl p-3 text-sm sm:max-w-[80%]",
                        message.sender === "user"
                          ? "bg-cyan-500 text-white"
                          : "border border-border bg-muted text-foreground",
                      )}
                    >
                      <div className="whitespace-pre-wrap break-words">
                        {message.content}
                      </div>
                      <div
                        className={cn(
                          "mt-1 text-xs",
                          message.sender === "user"
                            ? "text-right text-cyan-100"
                            : "text-muted-foreground",
                        )}
                      >
                        {message.timestamp.toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    </div>
                  </div>
                ))}

                {isTyping && (
                  <div className="flex items-start space-x-2">
                    <Avatar className="mt-1 h-6 w-6">
                      <AvatarFallback className="bg-cyan-500 text-xs text-white">
                        <Bot className="h-3 w-3" />
                      </AvatarFallback>
                    </Avatar>
                    <div className="rounded-2xl border border-border bg-muted p-3">
                      <div className="flex space-x-1">
                        {[0, 150, 300].map((delay) => (
                          <div
                            key={delay}
                            className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/60"
                            style={{ animationDelay: `${delay}ms` }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* Quick actions and input */}
            <div
              className="flex-shrink-0 border-t border-border p-3"
              style={{
                paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
              }}
            >
              <div className="mb-3 grid grid-cols-2 gap-2">
                {quickActions.map((action) => (
                  <Button
                    key={action.label}
                    variant="outline"
                    size="sm"
                    onClick={() => setInputValue(action.value)}
                    className="h-9 justify-start text-xs sm:h-8"
                  >
                    <Sparkles className="mr-1 h-3 w-3 flex-shrink-0" />
                    <span className="truncate">{action.label}</span>
                  </Button>
                ))}
              </div>

              <div className="flex items-center space-x-2">
                <Input
                  ref={inputRef}
                  value={inputValue}
                  onChange={(event) => setInputValue(event.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask about the fleet or a feature..."
                  className="min-w-0 flex-1 text-sm"
                  disabled={isTyping}
                />
                <Button
                  onClick={handleSendMessage}
                  disabled={!inputValue.trim() || isTyping}
                  size="sm"
                  className="h-10 w-10 flex-shrink-0 px-0 sm:h-9 sm:w-9"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}