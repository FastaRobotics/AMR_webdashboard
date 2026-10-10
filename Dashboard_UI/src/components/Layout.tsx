import React, { useState } from "react";
import { Link, useLocation } from "react-router";
import {
  LayoutDashboard,
  Wifi,
  Gamepad2,
  Camera,
  Map,
  Navigation,
  Target,
  Settings,
  Sun,
  Moon,
  Search,
  Bell,
  HelpCircle,
  ChevronRight,
  Menu,
  X,
  Bot,
  MessageSquare,
  Activity,
  Cpu,
  ChartNoAxesCombined,
  FlaskConical,
  Radio,
} from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";
import RobotStatusBar from "./RobotStatusBar";
import AIChatbot from "./AIChatbot";
import { cn } from "./ui/utils";

const navigationItems = [
  {
    path: "/",
    icon: LayoutDashboard,
    label: "Dashboard",
    shortLabel: "Overview",
    description: "System overview and quick stats",
    badge: null,
  },
  {
    path: "/robot-connection",
    icon: Wifi,
    label: "Connection",
    shortLabel: "Robot",
    description: "Manage robot connections",
    badge: "Online",
  },
  {
    path: "/manual-control",
    icon: Gamepad2,
    label: "Manual Control",
    shortLabel: "Control",
    description: "Direct robot teleoperation",
    badge: null,
  },
  {
    path: "/telemetry",
    icon: Activity,
    label: "Telemetry",
    shortLabel: "Telemetry",
    description: "Live robot sensor data and backend connection checks",
    badge: null,
  },
  {
    path: "/system-monitor",
    icon: Cpu,
    label: "System Monitor",
    shortLabel: "System",
    description: "Fake simulator health, engine timing, and hardware metrics",
    badge: null,
  },
  {
    path: "/robot-insights",
    icon: ChartNoAxesCombined,
    label: "Robot Insights",
    shortLabel: "Insights",
    description: "Robot tasks, maps, navigation, and recordings",
    badge: null,
  },
  {
    path: "/simulation-test-bench",
    icon: FlaskConical,
    label: "Simulation Test Bench",
    shortLabel: "Test Bench",
    description: "Test fake-backend battery, faults, maps, poses, and resets",
    badge: null,
  },
  {
    path: "/live-camera",
    icon: Camera,
    label: "Live Camera",
    shortLabel: "Camera",
    description: "Live video feeds and recording",
    badge: "Live",
  },
  {
    path: "/streaming-tools",
    icon: Radio,
    label: "Streaming Tools",
    shortLabel: "Streaming",
    description: "WebRTC producer, backend viewer, and relay diagnostics",
    badge: null,
  },
  {
    path: "/mapping",
    icon: Map,
    label: "Mapping",
    shortLabel: "Maps",
    description: "SLAM mapping and map management",
    badge: null,
  },
  {
    path: "/navigation",
    icon: Navigation,
    label: "Navigation",
    shortLabel: "Nav",
    description: "Autonomous navigation and path planning",
    badge: null,
  },
  {
    path: "/mission-control",
    icon: Target,
    label: "Mission Control",
    shortLabel: "Missions",
    description: "Mission planning and execution",
    badge: null,
  },
];

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const [isDark, setIsDark] = useState(false);
  /**
   * The expanded sidebar is 252px wide. On a phone that is most of the viewport,
   * so start collapsed there and let the operator expand it on demand. This is
   * presentation only — the toggle keeps working exactly as before.
   */
  const [isSidebarOpen, setIsSidebarOpen] = useState(
    () => typeof window === "undefined" || !window.matchMedia("(max-width: 767px)").matches,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [notifications] = useState(3);
  const [isChatbotOpen, setIsChatbotOpen] = useState(false);

  const toggleTheme = () => {
    setIsDark(!isDark);
    document.documentElement.classList.toggle("dark");
  };

  /**
   * Breadcrumb trail for the current route.
   *
   * On the dashboard itself there is no parent to show: prepending "Robot Fleet"
   * would produce "Robot Fleet / Overview", and because both crumbs then carry
   * the same path React saw two children with the identical key. A single crumb
   * is the honest answer.
   */
  const breadcrumbs = (() => {
    const currentItem = navigationItems.find(
      (item) => item.path === location.pathname,
    );

    if (location.pathname === "/") {
      return [{ label: "Dashboard", path: "/" }];
    }

    return [
      { label: "Dashboard", path: "/" },
      {
        label: currentItem?.label ?? currentItem?.shortLabel ?? "Page",
        path: location.pathname,
      },
    ];
  })();

  const filteredNavItems = navigationItems.filter(
    (item) =>
      item.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.description.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const openChatbot = () => {
    setIsChatbotOpen(true);
  };

  const closeChatbot = () => {
    setIsChatbotOpen(false);
  };

  return (
    <TooltipProvider>
      <div className="flex h-screen bg-background">
        {/* Sidebar */}
        <div
          className={cn(
            "bg-sidebar border-r border-sidebar-border flex flex-col transition-all duration-300 ease-in-out",
            isSidebarOpen ? "w-72" : "w-16",
          )}
        >
          {/* Logo/Header */}
          <div
            className={cn(
              "border-b border-sidebar-border",
              isSidebarOpen ? "p-4" : "px-2 py-3",
            )}
          >
            <div className="flex items-center justify-between gap-1">
              {isSidebarOpen ? (
                <div className="animate-fade-in min-w-0">
                  <h1 className="text-lg font-semibold text-sidebar-foreground tracking-tight truncate">
                    Robot Fleet Control
                  </h1>
                  <p className="text-xs text-sidebar-foreground/60 mt-1 truncate">
                    Industrial Operations Center
                  </p>
                </div>
              ) : (
                <div className="w-8 h-8 shrink-0 rounded-lg gradient-primary flex items-center justify-center">
                  <span className="text-white font-bold text-sm">R</span>
                </div>
              )}
              <Button
                variant="ghost"
                size="icon"
                aria-label={isSidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
                aria-expanded={isSidebarOpen}
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                className="text-sidebar-foreground hover:bg-sidebar-accent size-8 shrink-0"
              >
                {isSidebarOpen ? (
                  <X className="w-4 h-4" />
                ) : (
                  <Menu className="w-4 h-4" />
                )}
              </Button>
            </div>
          </div>

          {/* Search */}
          {isSidebarOpen && (
            <div className="p-4 border-b border-sidebar-border animate-slide-up">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search navigation..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 bg-sidebar-accent/50 border-sidebar-border focus:border-sidebar-primary"
                />
              </div>
            </div>
          )}

          {/* Navigation */}
          <nav
            className={cn(
              "flex-1 space-y-2 overflow-y-auto py-4",
              isSidebarOpen ? "px-4" : "px-2",
            )}
          >
            {filteredNavItems.map((item, index) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;

              return (
                <Tooltip key={item.path} delayDuration={300}>
                  <TooltipTrigger asChild>
                    <Link
                      to={item.path}
                      title={isSidebarOpen ? undefined : item.label}
                      className={cn(
                        "flex items-center rounded-xl transition-all duration-200 group relative",
                        "hover:scale-[1.02] hover:shadow-md",
                        isSidebarOpen ? "space-x-3 px-3 py-3" : "justify-center py-2",
                        isActive
                          ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-md shadow-sidebar-primary/20 scale-[1.02]"
                          : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
                        "animate-scale-in",
                      )}
                      style={{ animationDelay: `${index * 50}ms` }}
                    >
                      <div
                        className={cn(
                          "rounded-lg transition-colors",
                          isSidebarOpen ? "p-2" : "p-1.5",
                          isActive
                            ? "bg-sidebar-primary text-sidebar-primary-foreground"
                            : "bg-sidebar-accent/50",
                        )}
                      >
                        <Icon className="w-4 h-4" />
                      </div>
                      {isSidebarOpen && (
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="font-medium truncate">
                              {item.label}
                            </span>
                            {item.badge && (
                              <Badge
                                variant="secondary"
                                className={cn(
                                  "text-xs ml-2",
                                  item.badge === "Online" &&
                                  "bg-green-500/20 text-green-700",
                                  item.badge === "Live" &&
                                  "bg-red-500/20 text-red-700",
                                )}
                              >
                                {item.badge}
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-sidebar-foreground/60 truncate mt-0.5">
                            {item.description}
                          </p>
                        </div>
                      )}
                      {isActive && (
                        <div
                          className={cn(
                            "absolute w-1 h-6 bg-sidebar-primary rounded-full",
                            isSidebarOpen ? "right-2" : "right-0",
                          )}
                        />
                      )}
                    </Link>
                  </TooltipTrigger>
                  {!isSidebarOpen && (
                    <TooltipContent side="right" className="flex flex-col">
                      <span className="font-medium">{item.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {item.description}
                      </span>
                    </TooltipContent>
                  )}
                </Tooltip>
              );
            })}
          </nav>

          {/* Bottom Actions */}
          <div
            className={cn(
              "border-t border-sidebar-border space-y-2",
              isSidebarOpen ? "p-4" : "px-2 py-3",
            )}
          >
            <div className="flex items-center space-x-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={toggleTheme}
                    className={cn(
                      "text-sidebar-foreground hover:bg-sidebar-accent",
                      isSidebarOpen ? "flex-1" : "w-full",
                    )}
                  >
                    {isDark ? (
                      <Sun className="w-4 h-4" />
                    ) : (
                      <Moon className="w-4 h-4" />
                    )}
                    {isSidebarOpen && <span className="ml-2">Theme</span>}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side={isSidebarOpen ? "top" : "right"}>
                  Toggle {isDark ? "light" : "dark"} mode
                </TooltipContent>
              </Tooltip>

              {isSidebarOpen && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-sidebar-foreground hover:bg-sidebar-accent"
                    >
                      <HelpCircle className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Help & Documentation</TooltipContent>
                </Tooltip>
              )}
            </div>

            {isSidebarOpen && (
              <Button
                variant="ghost"
                className="w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent"
              >
                <Settings className="w-4 h-4 mr-2" />
                <span>Settings</span>
              </Button>
            )}
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Top Status Bar */}
          <RobotStatusBar />

          {/* Breadcrumbs */}
          <div className="px-4 sm:px-6 py-2.5 sm:py-3 border-b border-border bg-muted/30">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 sm:gap-2 text-sm min-w-0">
                {breadcrumbs.map((crumb, index) => (
                  <React.Fragment key={crumb.path}>
                    {index > 0 && (
                      <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />
                    )}
                    <Link
                      to={crumb.path}
                      className={cn(
                        "hover:text-primary transition-colors truncate",
                        index === breadcrumbs.length - 1
                          ? "text-foreground font-medium"
                          : "text-muted-foreground",
                      )}
                    >
                      {crumb.label}
                    </Link>
                  </React.Fragment>
                ))}
              </div>

              {/* AI Support Button in Header */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={openChatbot}
                    className={cn(
                      "shrink-0 hover:bg-primary/10 hover:border-primary/50 hover:text-primary transition-all duration-200",
                      isChatbotOpen &&
                      "bg-primary/10 border-primary/50 text-primary",
                    )}
                  >
                    <Bot className="w-4 h-4 sm:mr-2" />
                    <span className="hidden sm:inline">AI Support</span>
                    <Badge
                      variant="secondary"
                      className="hidden sm:inline-flex ml-2 bg-green-500/20 text-green-700 text-xs"
                    >
                      Online
                    </Badge>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <div className="text-center">
                    <p className="font-medium">AI Assistant</p>
                    <p className="text-xs text-muted-foreground">
                      Get help with robot operations
                    </p>
                  </div>
                </TooltipContent>
              </Tooltip>
            </div>
          </div>

          {/* Page Content */}
          <main className="flex-1 overflow-auto">
            <div className="animate-fade-in">{children}</div>
          </main>

          {/* Floating Action Buttons */}
          <div className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-30 flex flex-col gap-2.5 sm:gap-3">
            {/* AI Chatbot Button */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={openChatbot}
                  size="lg"
                  aria-label={isChatbotOpen ? "Close chatbot" : "Open chatbot"}
                  aria-expanded={isChatbotOpen}
                  className={cn(
                    "rounded-full size-12 sm:size-14 relative overflow-hidden group",
                    "border border-white/10",
                    "transition-all duration-300 ease-out",
                    "bg-gradient-to-br from-purple-500 via-blue-500 to-blue-600",
                    "hover:from-purple-400 hover:via-blue-400 hover:to-blue-500",
                    "shadow-[0_8px_24px_-6px_rgba(99,102,241,0.7),0_2px_8px_-2px_rgba(0,0,0,0.4)]",
                    "hover:shadow-[0_12px_32px_-6px_rgba(99,102,241,0.85),0_4px_12px_-2px_rgba(0,0,0,0.5)]",
                    "hover:scale-110 active:scale-95",
                    isChatbotOpen &&
                    "scale-110 shadow-[0_12px_36px_-6px_rgba(99,102,241,0.9),0_4px_14px_-2px_rgba(0,0,0,0.55)]",
                  )}
                >
                  {/* Soft inner highlight for depth */}
                  <span
                    aria-hidden
                    className="absolute inset-0 rounded-full bg-gradient-to-b from-white/25 via-transparent to-black/15 pointer-events-none"
                  />

                  {/* Icon */}
                  <MessageSquare className="w-6 h-6 text-white relative z-10 drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]" />

                  {/* Diagonal shine sweep on hover */}
                  <span
                    aria-hidden
                    className="absolute inset-0 rounded-full pointer-events-none -translate-x-[200%] group-hover:translate-x-[200%] transition-transform duration-700 ease-out bg-gradient-to-r from-transparent via-white/30 to-transparent"
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">
                <div className="text-center">
                  <p className="font-medium">AI Assistant</p>
                  <p className="text-xs text-muted-foreground">
                    Get instant help and support
                  </p>
                </div>
              </TooltipContent>
            </Tooltip>

            {/* Notifications Button */}
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="relative inline-block">
                  <Button
                    size="lg"
                    aria-label={
                      notifications > 0
                        ? `Notifications, ${notifications} unread`
                        : "Notifications"
                    }
                    className={cn(
                      "rounded-full size-12 sm:size-14 relative overflow-hidden group",
                      "border border-white/10",
                      "transition-all duration-300 ease-out",
                      "gradient-primary",
                      "shadow-[0_8px_24px_-6px_rgba(99,102,241,0.7),0_2px_8px_-2px_rgba(0,0,0,0.4)]",
                      "hover:shadow-[0_12px_32px_-6px_rgba(99,102,241,0.85),0_4px_12px_-2px_rgba(0,0,0,0.5)]",
                      "hover:scale-110 active:scale-95",
                    )}
                  >
                    {/* Inner highlight */}
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-b from-white/25 via-transparent to-black/15"
                    />

                    {/* Bell icon */}
                    <Bell className="relative z-10 w-6 h-6 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]" />

                    {/* Shine sweep (contained by overflow-hidden) */}
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-0 rounded-full -translate-x-[200%] group-hover:translate-x-[200%] transition-transform duration-700 ease-out bg-gradient-to-r from-transparent via-white/30 to-transparent"
                    />
                  </Button>

                  {/* Badge lives OUTSIDE the button so it can overflow the rounded edge */}
                  {notifications > 0 && (
                    <Badge
                      variant="destructive"
                      className={cn(
                        "absolute -top-1 -right-1 z-20 w-6 h-6 p-0 rounded-full text-xs font-semibold",
                        "ring-2 ring-white/70",
                        "shadow-[0_2px_6px_-1px_rgba(239,68,68,0.7)]",
                        "animate-bounce-gentle",
                        "pointer-events-none",
                      )}
                    >
                      {notifications}
                    </Badge>
                  )}
                </div>
              </TooltipTrigger>

              <TooltipContent side="left">
                <div className="text-center">
                  <p className="font-medium">Notifications</p>
                  <p className="text-xs text-muted-foreground">
                    {notifications} new alerts
                  </p>
                </div>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>

      {/* AI Chatbot */}
      <AIChatbot isOpen={isChatbotOpen} onClose={closeChatbot} />
    </TooltipProvider>
  );
}
