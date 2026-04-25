#!/usr/bin/env node

import { runAdminCli } from '../src/admin.js';

process.exitCode = await runAdminCli();
