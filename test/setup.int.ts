// Loads .env so integration tests pick up DB URL and API keys automatically.
import { loadEnvFile } from '../src/config.js';
loadEnvFile();
