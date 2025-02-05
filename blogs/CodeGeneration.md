---
layout: page
permalink: /blogs/CodeGeneration/index.html
title: CodeGeneration
---

### Self-Planning Code Generation with Large Language Models

Human knowledge: decompose complex problems into schedule solution steps prior to implementation

Two parts:
- planning phase 
  - plans out concise solution steps from the intent combined with few-shot
- implementation phase
  - generate code step by step following the solution steps


Human intent: What to do
LLM Solver: How to do

#### self-planning

1. The prompt is specilfally designed as k examples and the k is a small number. 

2. A step like "Check the number is prime" is better than "If a number is prime, it is not prime. Check if the number is divisible by any number between 2 and n-1. If the number is not dicisible by any number between 2 and n-1, it is prime"

#### Ealuation Methods

- RQ1: How does self-planning approach perform in code generation compared to baseline
approaches?
- RQ2: How does the self-planning approach perform based on different LLMs?
- RQ3: What is the optimal design for the self-planning approach?
- RQ4: How does self-planning approach perform in multilingual code generation?
- RQ5: How does the complexity of the problem affect self-planning?


