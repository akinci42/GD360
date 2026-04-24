param([string]$service = "backend")
docker compose exec $service npm install
Write-Host "Dependencies reinstalled in $service container"
