// Seed data: a fictional community proposal (Maple Park summer schedule), a few authored
// revisions, and neighbours' objections. The seed objections ship with hand-written rules so the
// app is usable offline; "Recompile" sends any objection's plain words to Nemotron again.
const S = (id, day, start, end, facility, activity, group, audience, noise, cost, lights = false) => ({ id, day, start, end, facility, activity, group, audience, noise, cost, lights });

export const seed = () => ({
  proposal: {
    title: "Maple Park summer schedule",
    blurb: "Draft weekly programme for the four shared spaces. Cost is what the parks office pays per week in staffing and permits.",
    facilities: ["Court A", "Field 1", "Playground", "Pavilion", "Dog Run"],
    slots: [
      S("s1", "Mon", "17:30", "19:00", "Field 1", "Youth soccer practice", "Maple Youth FC", "kids", 2, 40),
      S("s2", "Tue", "18:00", "20:00", "Court A", "Pickup basketball", "Open play", "adults", 2, 0),
      S("s3", "Wed", "18:30", "20:30", "Field 1", "Youth soccer practice", "Maple Youth FC", "kids", 2, 40),
      S("s4", "Thu", "20:00", "22:30", "Court A", "Basketball league", "Maple Hoops", "adults", 3, 120, true),
      S("s5", "Fri", "19:00", "23:00", "Pavilion", "Live music night", "Maple Arts", "all", 3, 300, true),
      S("s6", "Sat", "08:00", "13:00", "Pavilion", "Farmers market", "Market Co-op", "all", 2, 80),
      S("s7", "Sat", "09:00", "11:00", "Field 1", "Youth tournament", "Maple Youth FC", "kids", 3, 150),
      S("s8", "Sat", "18:00", "22:00", "Field 1", "Adult kickball league", "Kickball Society", "adults", 3, 100, true),
      S("s9", "Sat", "20:00", "23:30", "Pavilion", "Dance party", "Maple Arts", "adults", 3, 250, true),
      S("s10", "Sun", "07:00", "09:00", "Dog Run", "Off-leash hour", "Dog Owners", "all", 1, 0),
      S("s11", "Sun", "10:00", "12:00", "Playground", "Toddler storytime", "Library Friends", "kids", 1, 20),
      S("s12", "Sun", "15:00", "18:00", "Pavilion", "Private rentals", "Parks Office", "all", 2, 200),
      S("s13", "Mon", "09:00", "10:30", "Pavilion", "Seniors tai chi", "Seniors Centre", "seniors", 0, 0),
      S("s14", "Wed", "09:00", "10:30", "Pavilion", "Seniors tai chi", "Seniors Centre", "seniors", 0, 0),
      S("s15", "Tue", "07:00", "08:30", "Field 1", "Boot camp fitness", "Iron Maple", "adults", 3, 60),
      S("s16", "Thu", "17:30", "19:00", "Playground", "Parent and tot meetup", "Library Friends", "kids", 1, 0),
      S("s17", "Fri", "07:00", "08:30", "Field 1", "Boot camp fitness", "Iron Maple", "adults", 3, 60),
      S("s18", "Wed", "10:00", "11:30", "Pavilion", "Kids art camp", "Maple Arts", "kids", 2, 90),
    ],
  },
  revisions: [
    { id: "r0", name: "Original draft", author: "authored", note: "The proposal as first circulated.", ops: [] },
    { id: "r1", name: "Quiet evenings", author: "authored", note: "Pulls the late weeknight events earlier.", ops: [
      { op: "move", slot: "s4", start: "18:30", end: "21:00" },
      { op: "move", slot: "s5", start: "18:00", end: "21:00" },
    ] },
    { id: "r2", name: "Trim the cost", author: "authored", note: "Drops the two most expensive evening events.", ops: [
      { op: "remove", slot: "s5" },
      { op: "remove", slot: "s9" },
    ] },
  ],
  objections: [
    { id: "o1", author: "Dana", text: "Nothing loud should run past 9pm on weeknights. We live right across Maple Street.", supporters: ["Dana", "Ruth", "Omar"],
      rule: { kind: "forbid", where: { all: [{ field: "dayType", op: "==", value: "weekday" }, { field: "noise", op: ">=", value: 3 }, { field: "end", op: ">", value: "21:00" }] } },
      restatement: "No weekday event with noise 3 may end after 21:00.", source: "seed" },
    { id: "o2", author: "Marcus", text: "Kids' sessions on the unlit field have to be done by 8pm.", supporters: ["Marcus", "Lena"],
      rule: { kind: "forbid", where: { all: [{ field: "audience", op: "==", value: "kids" }, { field: "lights", op: "==", value: false }, { field: "end", op: ">", value: "20:00" }] } },
      restatement: "A kids' event without lights may not end after 20:00.", source: "seed" },
    { id: "o3", author: "Priya", text: "The seniors' tai chi can't share the pavilion with anything noisy at the same time.", supporters: ["Priya", "Ruth"],
      rule: { kind: "no_overlap", where: { field: "audience", op: "==", value: "seniors" }, where_b: { field: "noise", op: ">=", value: 2 }, same: "facility" },
      restatement: "Seniors' sessions must not overlap with noise-2-or-louder events in the same facility.", source: "seed" },
    { id: "o4", author: "Tom", text: "The weekly bill can't go over $1,200. The parks office does not have it.", supporters: ["Tom", "Omar"],
      rule: { kind: "limit", agg: "sum", field: "cost", op: "<=", value: 1200 },
      restatement: "Total weekly cost is at most $1,200.", source: "seed" },
    { id: "o5", author: "Lena", text: "Every day we cut is a group that loses its slot. Keep at least 16 events on the schedule.", supporters: ["Lena", "Marcus", "Priya"],
      rule: { kind: "limit", agg: "count", op: ">=", value: 16 },
      restatement: "The schedule keeps at least 16 events.", source: "seed" },
    { id: "o6", author: "Omar", text: "No day should have more than two really loud events.", supporters: ["Omar", "Dana"],
      rule: { kind: "limit", agg: "count", group_by: "day", where: { field: "noise", op: ">=", value: 3 }, op: "<=", value: 2 },
      restatement: "Each day has at most two events with noise 3.", source: "seed" },
  ],
});
