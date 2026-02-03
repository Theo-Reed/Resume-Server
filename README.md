# Puppet Resume - Backend
A professional AI-driven resume tailoring and PDF generation backend powered by Node.js, Puppeteer, and Gemini AI.
[中文版](./README_CN.md)

## Core Capability: Automatic Resume Tailoring

This project is more than just a PDF generator. Its flagship feature is **AI-Powered Resume Tailoring**: automatically filtering, highlighting, and optimizing a user's resume content based on a specific Job Description (JD) to ensure a perfect match for every application.

## Core Highlights

- 🧠 **Dual-Model AI Strategy**: Orchestrates **Gemini 2.5 Flash** for low-latency tasks and automatically falls back to **Gemini 3.0 Pro** for complex reasoning, maximizing both speed and accuracy.
- 📸 **Multi-modal Intelligence**: Native support for image-to-text JD extraction using Gemini Vision, enabling users to generate resumes starting from just a screenshot.
- ⚡ **High-Precision Rendering**: Enterprise-level PDF generation core using **Puppeteer**, producing pixel-perfect, industry-standard resume documents from dynamic React-like templates.
- 🛡️ **Mission-Critical Robustness**: Built with industrial standards including request timeouts, automatic error recovery, and background cleanup tasks for temporary assets.
- 💳 **Complete Fintech Lifecycle**: Fully integrated **WeChat Pay** suite including secure order creation, asynchronous callback verification, and automated membership status management.

## Features

- ✂️ **Smart AI Tailoring**: Analyzes JDs to rewrite work experiences and skills, creating a custom resume for every job.
- 📑 **High-Quality PDF Generation**: Uses Puppeteer to generate high-fidelity professional resumes.
- 🤖 **Gemini AI Integration**: Leverages Google Gemini for logical, natural, and persuasive content optimization.
- 🌍 **Multi-language Support**: Seamlessly generates resumes in both English and Chinese, handling localized date formats and terminology.

## Tech Stack

- **Runtime**: Node.js + TypeScript
- **Browser Automation**: Puppeteer
- **Database**: MongoDB
- **AI**: Google Generative AI (Gemini 2.5/3.0)
- **Payment**: WeChat Pay SDK

## License

ISC

