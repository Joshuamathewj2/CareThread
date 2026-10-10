# App Runner Deployment Guide

For the Alexa+ Hackathon, the easiest way to get an HTTPS endpoint for the CareThread MCP server is AWS App Runner.

## 1. Push to ECR
1. Create an ECR repository named `carethread-server`.
2. Authenticate Docker to ECR:
   \`\`\`bash
   aws ecr get-login-password --region <your-region> | docker login --username AWS --password-stdin <account>.dkr.ecr.<region>.amazonaws.com
   \`\`\`
3. Build and push the server image:
   \`\`\`bash
   docker build -t carethread-server ./server
   docker tag carethread-server:latest <account>.dkr.ecr.<region>.amazonaws.com/carethread-server:latest
   docker push <account>.dkr.ecr.<region>.amazonaws.com/carethread-server:latest
   \`\`\`

## 2. Deploy on App Runner
1. Go to AWS App Runner console.
2. Click **Create service**.
3. Choose **Amazon ECR** and select the `carethread-server` image.
4. Set the port to `3001`.
5. Add the environment variable `DATABASE_PATH = /tmp/carethread.db` (App Runner instances are ephemeral; for production, migrate to DynamoDB or use EFS on ECS Fargate. For the demo, this works if you don't mind data resetting on deploy).
6. Complete creation. You will get a `https://...awsapprunner.com` URL.

## 3. Connect Alexa+
Provide the App Runner URL `https://...awsapprunner.com/mcp` as your endpoint in the Alexa developer console. Ensure you configure Bearer token auth in the Alexa skills console to match the hardcoded MVP token (e.g., `m_priya`) or implement OAuth 2.1.
