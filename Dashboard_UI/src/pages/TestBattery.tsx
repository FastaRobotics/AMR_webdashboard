import BatteryStatus from "../components/BatteryStatus"; // adjust import path as needed

export default function TestBattery() {
  const testCases = [
    {
      label: "No battery data (null)",
      battery: null,
    },
    {
      label: "0% (empty)",
      battery: { percentage: 0 },
    },
    {
      label: "29% (red zone)",
      battery: { percentage: 0.29 },
    },
    {
      label: "30% (yellow border)",
      battery: { percentage: 0.3 },
    },
    {
      label: "59% (yellow zone)",
      battery: { percentage: 0.59 },
    },
    {
      label: "60% (green zone)",
      battery: { percentage: 0.6 },
    },
    {
      label: "100% (full)",
      battery: { percentage: 1.0 },
    },
    {
      label: "With voltage only",
      battery: { percentage: 0.75, voltage: 12.34 },
    },
    {
      label: "With current only",
      battery: { percentage: 0.4, current: -1.5 }, // negative = discharging
    },
    {
      label: "With both voltage and current",
      battery: { percentage: 0.9, voltage: 14.2, current: 0.0 },
    },
    {
      label: "Out of range (>1)",
      battery: { percentage: 1.5 }, // should clamp to 1.0
    },
    {
      label: "Out of range (<0)",
      battery: { percentage: -0.2 }, // should clamp to 0.0
    },
  ];

  return (
    <div className="p-6 pb-28 space-y-6">
      <h1 className="text-2xl font-bold">Battery Status Test</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {testCases.map((test, idx) => (
          <div
            key={idx}
            className="border border-gray-300 p-4 rounded-lg bg-gray-50 dark:bg-gray-800"
          >
            <h2 className="text-lg font-semibold mb-3 text-gray-800 dark:text-gray-200">
              {test.label}
            </h2>
            <BatteryStatus battery={test.battery} />
          </div>
        ))}
      </div>
    </div>
  );
}
