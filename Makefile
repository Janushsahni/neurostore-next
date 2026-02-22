.PHONY: test test-control-plane test-s3-gateway test-rust build compose-up compose-down smoke k8s-apply perf-benchmark kpi-gate

build:
	cargo build --workspace

test: test-rust test-control-plane test-s3-gateway

test-rust:
	cargo test --workspace

test-control-plane:
	cd services/control-plane && node --test test/*.test.mjs

test-s3-gateway:
	cd services/s3-gateway && node --test test/*.test.mjs

compose-up:
	docker compose -f deploy/docker-compose.option-a.yml up --build

compose-down:
	docker compose -f deploy/docker-compose.option-a.yml down

smoke:
	./scripts/option-a-smoke.sh

k8s-apply:
	kubectl apply -k deploy/k8s/base

perf-benchmark:
	./scripts/perf-kpi-gate.sh

kpi-gate:
	./scripts/perf-kpi-gate.sh --strict
