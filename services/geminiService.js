const { GoogleGenerativeAI } = require('@google/generative-ai');

const defaultResumeData = {
    summary: "Full Stack Developer (Fresher) with a strong foundation in MERN stack. Experienced in building responsive web applications using React, Node.js, and MongoDB. Developed real-world projects including a used car marketplace with JWT authentication and REST APIs. Passionate about writing clean code, learning new technologies, and building scalable applications.",
    highlightedPoints: [
        "Developed and maintained scalable backend applications.",
        "Collaborated with cross-functional teams to deliver software solutions.",
        "Optimized code for maximum speed and scalability."
    ],
    skills: {
        languages: "JavaScript, TypeScript",
        frontend: "HTML5, CSS3, Tailwind CSS, React.js",
        backend: "Node.js, Express.js",
        databases: "MongoDB, MySQL",
        tools: "Git, GitHub, Postman, VS Code",
        concepts: "REST APIs, JWT Authentication, Responsive Design"
    },
    projects: {
        project1: [
            "Designed and developed a full stack marketplace platform for individuals and dealers to list used cars.",
            "Implemented JWT authentication and role-based access control.",
            "Built REST APIs using Node.js and Express.js.",
            "Integrated MongoDB for user and vehicle data management.",
            "Created responsive UI using React.js and Tailwind CSS."
        ],
        project2: [
            "Built interactive CSS learning platform using React, TypeScript, TailwindCSS.",
            "Visualized Flexbox, Grid, Position, and Z-Index in real time.",
            "Created modular UI components with live state updates.",
            "Integrated Express.js backend with WebSockets."
        ],
        project3: [
            "Developed coding practice platform with instant feedback system.",
            "Categorized challenges by difficulty levels.",
            "Built reusable and modular UI components.",
            "Optimized performance across devices."
        ]
    }
};

async function generateResumePoints(jobDescription) {
    if (!process.env.GEMINI_API_KEY) {
        console.warn("[Gemini] No GEMINI_API_KEY found in .env. Returning default resume data.");
        return defaultResumeData;
    }

    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        // Use gemini-2.5-flash for speed and JSON output support
        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash",
            generationConfig: { responseMimeType: "application/json" }
        });

        const prompt = `
        You are an expert resume writer. I will provide you with a Job Description.
        Your task is to tailor a software engineer candidate's resume content to align with this Job Description.
        
        The candidate is a Fresher Full Stack Developer with strong MERN stack skills.
        Here are the standard details of the candidate's resume:
        - Summary: "Full Stack Developer (Fresher) with a strong foundation in MERN stack. Experienced in building responsive web applications using React, Node.js, and MongoDB. Developed real-world projects including a used car marketplace with JWT authentication and REST APIs. Passionate about writing clean code, learning new technologies, and building scalable applications."
        - Projects:
          1. "1Shift Down – Used Car Marketplace" (MERN stack, JWT, REST APIs, Tailwind CSS)
          2. "CSS Learning Playground" (React, TypeScript, TailwindCSS, Express.js, WebSockets)
          3. "Code Master" (Frontend practice platform, React, modular components)
        
        Generate a JSON object with the following fields:
        1. "summary": A rewritten professional summary paragraph (3-4 sentences) that highlights MERN stack skills, but emphasizes technologies, patterns, or methodologies requested in the Job Description (e.g. if Java/C2C or scalability/performance is mentioned, phrase the MERN stack background to show strong transferable skills like OOP, backend architecture, or REST API design).
        2. "highlightedPoints": Exactly 3 professional bullet points (each 1 sentence long) under "Highlighted Skills Relevant to this Role" that highlight candidate's experience or knowledge in the top requirements of the JD.
        3. "skills": An object containing categories:
           - "languages": Comma-separated list of programming languages (e.g., JavaScript, TypeScript, and others relevant/transferable).
           - "frontend": Comma-separated list of frontend technologies relevant to the JD.
           - "backend": Comma-separated list of backend technologies relevant to the JD.
           - "databases": Comma-separated list of databases.
           - "tools": Comma-separated list of tools.
           - "concepts": Comma-separated list of concepts (e.g., REST APIs, JWT, Responsive Design, WebSockets, OOP, etc.).
        4. "projects": An object containing:
           - "project1": Exactly 5 bullet points tailoring the "1Shift Down" marketplace project. Highlight aspects like API design, JWT authentication, data modeling, role-based controls, or responsive UI to align with what the JD values.
           - "project2": Exactly 4 bullet points tailoring the "CSS Learning Playground" project. Highlight aspects like modular component design, WebSocket real-time communication, CSS layout models, or TypeScript state management.
           - "project3": Exactly 4 bullet points tailoring the "Code Master" project. Highlight aspects like reusable components, frontend performance, layout rendering, or modular architecture.
        
        Important Guidelines:
        - Do NOT invent projects that the candidate didn't do. Keep the project names and core technologies as described.
        - Ensure all generated text is professional and grammatically correct.
        - Avoid using LaTeX special characters directly if possible, or we will escape them. Do not output LaTeX markup inside the JSON text, only plain text.
        - CRITICAL FOR VALID JSON: Do NOT use double-quotes (") inside string values. If you need to write quotes inside a string, use single quotes (') instead. This prevents JSON parsing errors.
        
        JSON schema structure:
        {
          "summary": "...",
          "highlightedPoints": ["...", "...", "..."],
          "skills": {
            "languages": "...",
            "frontend": "...",
            "backend": "...",
            "databases": "...",
            "tools": "...",
            "concepts": "..."
          },
          "projects": {
            "project1": ["...", "...", "...", "...", "..."],
            "project2": ["...", "...", "...", "..."],
            "project3": ["...", "...", "...", "..."]
          }
        }

        Job Description:
        ${jobDescription}
        `;

        const result = await model.generateContent(prompt);
        const responseText = result.response.text();
        const data = JSON.parse(responseText);

        // Simple validation to ensure all required fields are present
        if (!data.summary || !Array.isArray(data.highlightedPoints) || data.highlightedPoints.length < 3 || !data.skills || !data.projects) {
            throw new Error("Invalid JSON structure returned by Gemini.");
        }

        return {
            summary: data.summary,
            highlightedPoints: data.highlightedPoints.slice(0, 3),
            skills: {
                languages: data.skills.languages || defaultResumeData.skills.languages,
                frontend: data.skills.frontend || defaultResumeData.skills.frontend,
                backend: data.skills.backend || defaultResumeData.skills.backend,
                databases: data.skills.databases || defaultResumeData.skills.databases,
                tools: data.skills.tools || defaultResumeData.skills.tools,
                concepts: data.skills.concepts || defaultResumeData.skills.concepts
            },
            projects: {
                project1: Array.isArray(data.projects.project1) ? data.projects.project1.slice(0, 5) : defaultResumeData.projects.project1,
                project2: Array.isArray(data.projects.project2) ? data.projects.project2.slice(0, 4) : defaultResumeData.projects.project2,
                project3: Array.isArray(data.projects.project3) ? data.projects.project3.slice(0, 4) : defaultResumeData.projects.project3
            }
        };

    } catch (error) {
        console.error("[Gemini] Error generating resume points, returning default data:", error.message);
        return defaultResumeData;
    }
}

module.exports = { generateResumePoints };

