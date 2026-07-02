# CoPaw Test & Coverage Makefile

# ============================================================
# Dev targets
# ============================================================

# --- venv 路径 ---
VENV := $(CURDIR)/.venv

# --- venv 环境管理 ---
.PHONY: venv
venv:
	@echo "=== 创建/检查 .venv 环境 ==="
	@test -x $(VENV)/bin/python || python3 -m venv $(VENV)
	@$(VENV)/bin/pip install -q --upgrade pip setuptools wheel
	@echo "=== .venv 就绪 ==="

# 构建前端控制台并复制到 Python 包目录
.PHONY: build-console
build-console:
	@echo "=== 构建前端控制台 ==="
	cd console && npm ci && npm run build
	@echo "=== 复制构建产物到 src/qwenpaw/console/ ==="
	mkdir -p src/qwenpaw/console
	cp -R console/dist/. src/qwenpaw/console/
	@if [ -d "$(VENV)" ]; then \
		CONSOLE_DIR=$$($(VENV)/bin/python -c "import qwenpaw.console, pathlib; print(pathlib.Path(qwenpaw.console.__file__).parent)" 2>/dev/null || echo ""); \
		if [ -n "$$CONSOLE_DIR" ] && [ -d "$$CONSOLE_DIR" ] && [ "$$CONSOLE_DIR" != "$(CURDIR)/src/qwenpaw/console" ]; then \
			echo "=== 同步构建产物到 .venv: $$CONSOLE_DIR/ ==="; \
			cp -R console/dist/. "$$CONSOLE_DIR/"; \
		fi; \
	fi
	@echo "=== 前端构建完成 ==="

# 一键开发安装：构建前端 + .venv 中安装 QwenPaw + pet 桌面依赖
.PHONY: dev
dev: venv build-console
	@echo "=== 在 .venv 中安装 QwenPaw（editable） ==="
	$(VENV)/bin/pip install -e .
	@echo "=== 安装桌面宠物依赖（PySide6） ==="
	$(VENV)/bin/pip install -r plugins/bundle/qwenpaw-pet/requirements.txt
	@echo ""
	@echo "========================================"
	@echo "  make dev 完成"
	@echo "  启动: $(VENV)/bin/qwenpaw start"
	@echo "========================================"




.PHONY: test test-unit test-contract test-integration test-channel test-channel-contract coverage-full clean

# Python path
PYTHON := python
PYTEST := python -m pytest

# Default: run all tests
test:
	$(PYTEST) tests/ -v --tb=short -q

# Unit tests only
test-unit:
	$(PYTEST) tests/unit/ -v --tb=short

# Contract tests (interface compliance)
test-contract:
	$(PYTEST) tests/contract/ -v --tb=short

# Integration tests
test-integration:
	$(PYTEST) tests/integration/ -v --tb=short

# Full coverage (all modules)
coverage-full:
	$(PYTEST) tests/unit/ tests/integration/ -v \
		--cov=src/qwenpaw \
		--cov-report=term-missing \
		--cov-report=html

# Check contract coverage for all channels
check-contracts:
	$(PYTHON) scripts/check_channel_contracts.py

# Clean generated files
clean:
	rm -rf htmlcov/ .pytest_cache/
	rm -f coverage.xml coverage-sa.xml .coverage

# Quick check (fast feedback)
quick:
	$(PYTEST) tests/unit/ -x -q --tb=line

# Channel-specific tests
test-channel:
	@echo "Running Channel unit tests..."
	$(PYTEST) tests/unit/channels/ -v --tb=short

test-channel-contract:
	@echo "Running Channel contract tests..."
	$(PYTEST) tests/contract/channels/ -v --tb=short

# BaseChannel core unit tests (optional, not enforced)
test-base-core:
	$(PYTEST) tests/unit/channels/test_base_core.py -v
