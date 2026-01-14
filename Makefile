# Simple helper targets for local examples

JOBS ?= 100
CONCURRENCY ?= 10
JOB_SERVICE_URL ?= http://localhost:8787

.PHONY: examples-perms examples sal sal-restart sal-demo-multi-step

examples-perms:
	chmod +x examples/multi-job/start.sh
	@if [ -f examples/load-test.sh ]; then chmod +x examples/load-test.sh; fi

examples: examples-perms
	@echo "Examples ready. Try: JOBS=100 CONCURRENCY=10 JOB_SERVICE_URL=http://localhost:8787 examples/multi-job/start.sh"

# Build and start the SAL stack (automation, UI, job-service) from scratch.
sal:
	docker compose --profile jobs build lightpanda job-service ui automation
	docker compose --profile jobs up -d lightpanda job-service ui
	@echo "Waiting for services to initialize..."
	@sleep 10
	@echo "Checking job service health..."
	@curl -sf http://localhost:8787/health > /dev/null && echo "✓ Job service is ready" || echo "✗ Job service not ready"
	@echo "SAL is up. UI: http://localhost:8787/ui"

# Restart the SAL stack (rebuild and include Lightpanda)
sal-restart:
	docker compose --profile jobs build lightpanda job-service ui automation
	docker compose --profile jobs up -d lightpanda job-service ui
	@echo "Waiting for services to initialize..."
	@sleep 10
	@echo "Checking job service health..."
	@curl -sf http://localhost:8787/health > /dev/null && echo "✓ Job service is ready" || echo "✗ Job service not ready"
	@echo "SAL restarted. UI: http://localhost:8787/ui"

# Run the multi-job demo load test (same prompt, many jobs)
# This waits for the job service to be healthy before running
sal-demo-multi-step: examples-perms
	@echo "Checking if job service is running..."
	@timeout=30; while [ $$timeout -gt 0 ]; do \
		if curl -sf http://localhost:8787/health > /dev/null 2>&1; then \
			echo "✓ Job service is ready"; \
			break; \
		fi; \
		echo "Waiting for job service... ($$timeout seconds remaining)"; \
		sleep 2; \
		timeout=$$((timeout - 2)); \
	done
	@if ! curl -sf http://localhost:8787/health > /dev/null 2>&1; then \
		echo "✗ Job service is not responding. Run 'make sal-restart' first."; \
		exit 1; \
	fi
	@echo "Starting multi-job test with JOBS=$(JOBS) CONCURRENCY=$(CONCURRENCY)"
	JOBS=$(JOBS) CONCURRENCY=$(CONCURRENCY) JOB_SERVICE_URL=$(JOB_SERVICE_URL) examples/multi-job/start.sh

# Run the multi-prompt demo (many different prompts, semantic cache test)
sal-demo-multi-prompt: examples-perms
	@chmod +x examples/multi-prompt/run.sh
	@echo "Checking if job service is running..."
	@timeout=30; while [ $$timeout -gt 0 ]; do \
		if curl -sf http://localhost:8787/health > /dev/null 2>&1; then \
			echo "✓ Job service is ready"; \
			break; \
		fi; \
		echo "Waiting for job service... ($$timeout seconds remaining)"; \
		sleep 2; \
		timeout=$$((timeout - 2)); \
	done
	@if ! curl -sf http://localhost:8787/health > /dev/null 2>&1; then \
		echo "✗ Job service is not responding. Run 'make sal-restart' first."; \
		exit 1; \
	fi
	@echo "Starting multi-prompt demo with 30 diverse prompts"
	CONCURRENCY=$(CONCURRENCY) JOB_SERVICE_URL=$(JOB_SERVICE_URL) examples/multi-prompt/run.sh
