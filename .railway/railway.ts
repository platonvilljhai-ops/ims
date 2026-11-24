import { defineRailway, github, project, service } from "railway/iac";
// This repository manages only its own resources in the environment. Other
// repositories export their own partial name.
// See https://docs.railway.com/infrastructure-as-code#multi-repo-projects
export const partial = "edushelf-web";
export default defineRailway(() => {
  const edushelfWeb = service("edushelf-web", {
    source: github("platonvilljhai-ops/ims"),
    build: { buildEnvironment: "V3", builder: "RAILPACK" },
    start: "sh start.sh",
    healthcheck: "/",
    healthcheckTimeout: 300,
    preDeploy: "python deploy/prepare_db.py",
    replicas: { "iad": 1 },
  });

  return project("edushelf-ims", {
    variables: { managed: false },
    resources: [edushelfWeb],
  });
});
