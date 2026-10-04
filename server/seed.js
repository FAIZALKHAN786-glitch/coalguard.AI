import bcrypt from "bcryptjs";
import { uuid, now, audit, transaction } from "./db.js";
const day = (n) =>
  new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
export function seed(db, demo) {
  if (db.prepare("SELECT count(*) n FROM users").get().n) return;
  if (
    !demo &&
    (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 12)
  )
    throw new Error(
      "Set ADMIN_PASSWORD (12+ characters) before starting with DEMO_MODE=false.",
    );
  transaction(db, () => {
    const users = demo
      ? [
          [
            "u-admin",
            "Aarav Sharma",
            "admin@coalguard.demo",
            "CoalGuard@2026",
            "admin",
            [],
          ],
          [
            "u-officer",
            "Priya Singh",
            "officer@coalguard.demo",
            "CoalGuard@2026",
            "officer",
            ["gevra", "dipka"],
          ],
          [
            "u-field",
            "Ravi Kumar",
            "field@coalguard.demo",
            "CoalGuard@2026",
            "field",
            ["gevra"],
          ],
          [
            "u-regulator",
            "Ananya Rao",
            "regulator@coalguard.demo",
            "CoalGuard@2026",
            "regulator",
            [],
          ],
        ]
      : [
          [
            uuid(),
            "Administrator",
            process.env.ADMIN_EMAIL || "admin@coalguard.local",
            process.env.ADMIN_PASSWORD,
            "admin",
            [],
          ],
        ];
    for (const [id, name, email, password, role, mines] of users)
      db.prepare("INSERT INTO users VALUES(?,?,?,?,?,?)").run(
        id,
        name,
        email,
        bcrypt.hashSync(password, 12),
        role,
        JSON.stringify(mines),
      );
    if (!demo) return;
    const mines = [
      [
        "gevra",
        "Gevra Open Cast",
        "SECL",
        "Korba, Chhattisgarh",
        22.344,
        82.564,
        70,
      ],
      [
        "kusmunda",
        "Kusmunda Open Cast",
        "SECL",
        "Korba, Chhattisgarh",
        22.314,
        82.583,
        50,
      ],
      [
        "dipka",
        "Dipka Open Cast",
        "SECL",
        "Korba, Chhattisgarh",
        22.354,
        82.55,
        35,
      ],
      [
        "nigahi",
        "Nigahi Open Cast",
        "NCL",
        "Singrauli, Madhya Pradesh",
        24.133,
        82.637,
        25,
      ],
      [
        "jayant",
        "Jayant Open Cast",
        "NCL",
        "Singrauli, Madhya Pradesh",
        24.168,
        82.665,
        25,
      ],
      [
        "bina",
        "Bina Open Cast",
        "NCL",
        "Sonbhadra, Uttar Pradesh",
        24.145,
        82.768,
        10,
      ],
    ];
    for (const m of mines)
      db.prepare("INSERT INTO mines VALUES(?,?,?,?,?,?,?)").run(...m);
    const insert = db.prepare(
      "INSERT INTO records(id,kind,mine_id,title,category,status,priority,due_date,owner,notes,data,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    );
    function add(
      kind,
      mine,
      title,
      category,
      status,
      priority,
      due,
      owner,
      data = {},
      notes = "",
    ) {
      const id = uuid();
      insert.run(
        id,
        kind,
        mine,
        title,
        category,
        status,
        priority,
        due,
        owner,
        notes,
        JSON.stringify(data),
        "u-admin",
        now(),
        now(),
      );
      return id;
    }
    const regulations = [
      [
        "Annual mine safety return",
        "Safety",
        "DGMS annual return",
        "Priya Singh",
      ],
      [
        "Ambient air quality report",
        "Environment",
        "Environmental clearance conditions",
        "R. Verma",
      ],
      [
        "Contract labour licence renewal",
        "Labour",
        "Contract Labour Act, 1970",
        "S. Mehta",
      ],
      [
        "Monthly production return",
        "Production",
        "Coal Controller reporting requirements",
        "A. Patel",
      ],
      [
        "Emergency response drill",
        "Safety",
        "Coal Mines Regulations, 2017",
        "V. Kumar",
      ],
      [
        "Water discharge assessment",
        "Environment",
        "Consent to operate conditions",
        "R. Verma",
      ],
      ["Worker medical examination", "Labour", "Mines Rules, 1955", "S. Mehta"],
      [
        "Explosives storage inspection",
        "Safety",
        "Explosives Rules, 2008",
        "Priya Singh",
      ],
    ];
    mines.forEach((m, mi) =>
      regulations.forEach(([title, cat, reg, owner], i) => {
        const compliant = (i + mi) % 5 !== 0;
        add(
          "compliance",
          m[0],
          title,
          cat,
          compliant
            ? "compliant"
            : (i + mi) % 3 === 0
              ? "overdue"
              : "in_progress",
          (i + mi) % 3 === 0 ? "high" : "medium",
          day(compliant ? 20 : (i + mi) % 3 === 0 ? -3 - mi : 2 + mi),
          owner,
          { regulation: reg, documentId: "" },
          "Illustrative control only. Confirm current statutory obligations and deadlines with your compliance team.",
        );
      }),
    );
    add(
      "inspection",
      "gevra",
      "Pit & haul road safety audit",
      "Safety",
      "scheduled",
      "high",
      day(0),
      "Priya Singh",
      { inspector: "Priya Singh", findings: "" },
    );
    add(
      "inspection",
      "dipka",
      "Environmental monitoring review",
      "Environment",
      "in_progress",
      "medium",
      day(0),
      "R. Verma",
      {
        inspector: "R. Verma",
        findings: "Review dust suppression logs and sample stations.",
      },
    );
    add(
      "inspection",
      "nigahi",
      "Contractor equipment inspection",
      "Equipment",
      "scheduled",
      "medium",
      day(1),
      "V. Kumar",
      { inspector: "V. Kumar", findings: "" },
    );
    add(
      "inspection",
      "kusmunda",
      "Quarterly electrical safety inspection",
      "Safety",
      "completed",
      "low",
      day(-2),
      "A. Patel",
      {
        inspector: "A. Patel",
        findings: "Earth resistance checks complete. No deficiencies recorded.",
      },
    );
    add(
      "action",
      "gevra",
      "Restore dust suppression on haul road 3",
      "Environment",
      "open",
      "critical",
      day(1),
      "R. Verma",
      { sourceId: "", resolution: "" },
      "Dust readings increased during the afternoon shift. Inspect spray nozzles and record corrective evidence.",
    );
    add(
      "action",
      "dipka",
      "Replace damaged conveyor guard",
      "Safety",
      "in_progress",
      "high",
      day(-1),
      "V. Kumar",
      { sourceId: "", resolution: "" },
      "Isolate affected equipment until the guard is replaced and inspected.",
    );
    add(
      "action",
      "nigahi",
      "Verify contractor training records",
      "Labour",
      "open",
      "medium",
      day(3),
      "S. Mehta",
      { sourceId: "", resolution: "" },
    );
    for (const [i, name] of [
      "Aditya Earthmovers Pvt. Ltd.",
      "Vishal Mining Services",
      "Eastern Coal Logistics",
      "Sai Infrastructure",
      "Bharat Heavy Equipment",
    ].entries())
      add(
        "contractor",
        mines[i % 3][0],
        name,
        "Mining services",
        i === 1 ? "under_review" : "active",
        i === 1 ? "high" : "low",
        day(i === 1 ? 5 : 90 + i * 30),
        "S. Mehta",
        {
          workers: [342, 186, 264, 98, 76][i],
          contact: `operations@contractor${i + 1}.example`,
          license: `DEMO-CL-${2041 + i}`,
        },
      );
    for (let d = -13; d <= 0; d++)
      mines.forEach((m, i) => {
        add(
          "operation",
          m[0],
          `Daily production · ${day(d)}`,
          "Production",
          "verified",
          "low",
          day(d),
          "A. Patel",
          {
            tonnes: Math.round(
              ((m[6] * 1000000) / 365) * (0.76 + ((d + 14 + i) % 7) * 0.025),
            ),
            target: Math.round((m[6] * 1000000) / 365),
            shift: "Morning",
          },
        );
      });
    mines.forEach((m, i) =>
      add(
        "environment",
        m[0],
        "Ambient monitoring station 01",
        "Environment",
        i === 0 ? "flagged" : "verified",
        i === 0 ? "high" : "low",
        day(0),
        "R. Verma",
        {
          pm10: i === 0 ? 128 : 62 + i * 6,
          waterPh: 7.1 + i * 0.1,
          noise: 59 + i * 3,
        },
        "Demonstration readings; not certified measurements.",
      ),
    );
    add(
      "grievance",
      "gevra",
      "Drinking water point requires maintenance",
      "Welfare",
      "open",
      "medium",
      day(3),
      "S. Mehta",
      { reporter: "Worker representative", resolution: "" },
    );
    add(
      "field",
      "gevra",
      "Standing water near access road",
      "Safety",
      "open",
      "medium",
      day(0),
      "Ravi Kumar",
      {
        latitude: 22.344,
        longitude: 82.564,
        accuracy: 25,
        capturedAt: now(),
        locationSource: "device",
      },
      "Seeded example observation. Inspect drainage before the next shift.",
    );
    for (let i = 0; i < 6; i++)
      add(
        "attendance",
        "gevra",
        `Worker ${101 + i}`,
        "Attendance",
        i === 5 ? "absent" : "present",
        "low",
        day(0),
        "Ravi Kumar",
        { workerId: `DEMO-W${101 + i}`, shift: "Morning", contractorId: "" },
      );
    audit(
      db,
      { id: "u-admin", name: "Aarav Sharma" },
      "initialized",
      "workspace",
      null,
      {
        mode: "demonstration",
        message: "Fictional records created for workflow evaluation.",
      },
    );
  });
}
