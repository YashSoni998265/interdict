# Security Policy

Interdict is a hackathon project. It runs only on **synthetic data** and, in its public deployment, only in **simulation mode**: it never changes real infrastructure.

## Reporting a vulnerability
Please report vulnerabilities **privately** through GitHub: **Security → Report a vulnerability** on this repository. Do not open a public issue for a security problem. During the event (Oct 15–18, 2026) we aim to respond within 24 hours.

## Scope
- In scope: the application code in this repository and its public demo deployment.
- Out of scope: findings that depend on the synthetic dataset being "real" (it is not), and denial-of-service testing against the public demo.

## Secrets handling
Secrets live only in deployment secret stores and local `.env` files, which are never committed (`.env.example` documents the variables). CI runs gitleaks on every pull request; GitHub secret scanning and push protection are enabled on this repository.
