"""Flask web server for Polymarket Analyzer.

Provides REST API endpoints for analyzing wallets and checking job status.
Implements async job processing with state persistence support.
"""

from __future__ import annotations

import json
import uuid
import time
from threading import Thread
from typing import Any, Dict
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

# Import the existing analyzer logic
import polymarket_analyzer

app = Flask(__name__, static_folder='static')
CORS(app)

# In-memory job storage (in production, use Redis or similar)
jobs: Dict[str, Dict[str, Any]] = {}

# Maximum age for job results (24 hours)
JOB_TTL = 24 * 60 * 60


def cleanup_old_jobs():
    """Remove jobs older than 24 hours."""
    now = time.time()
    expired = [job_id for job_id, job in jobs.items() 
               if now - job.get('timestamp', 0) > JOB_TTL]
    for job_id in expired:
        del jobs[job_id]


def analyze_wallet_async(job_id: str, address: str, rpc_url: str):
    """Background task to analyze a wallet."""
    try:
        jobs[job_id]['status'] = 'in_progress'
        jobs[job_id]['progress'] = {
            'step': 'proxy_resolution',
            'percentage': 10,
            'message': 'Resolving proxy wallet...'
        }
        
        # Step 1: Resolve proxy wallet
        proxy = polymarket_analyzer.resolve_proxy_wallet(address, rpc_url)
        
        if not proxy:
            jobs[job_id]['qualityWarnings'].append({
                'type': 'proxy_not_found',
                'message': 'No proxy wallet found. This address may not have traded on Polymarket.',
                'timestamp': int(time.time())
            })
        
        jobs[job_id]['progress'] = {
            'step': 'trade_fetch',
            'percentage': 30,
            'message': 'Fetching trade history...'
        }
        
        # Step 2: Fetch trades
        query_addr = proxy or address
        try:
            trades = polymarket_analyzer.fetch_all_trades(query_addr)
        except Exception as e:
            jobs[job_id]['qualityWarnings'].append({
                'type': 'incomplete_data',
                'message': f'Could not fetch complete trade history: {str(e)}',
                'timestamp': int(time.time())
            })
            trades = []
        
        jobs[job_id]['progress'] = {
            'step': 'position_fetch',
            'percentage': 60,
            'message': 'Fetching positions...'
        }
        
        # Step 3: Fetch positions
        try:
            positions = polymarket_analyzer.fetch_positions(query_addr)
        except Exception as e:
            jobs[job_id]['qualityWarnings'].append({
                'type': 'incomplete_data',
                'message': f'Could not fetch positions: {str(e)}',
                'timestamp': int(time.time())
            })
            positions = []
        
        jobs[job_id]['progress'] = {
            'step': 'scoring',
            'percentage': 80,
            'message': 'Calculating airdrop score...'
        }
        
        # Step 4: Analyze and score
        summary = polymarket_analyzer.summarize(address, proxy, trades, positions)
        airdrop = polymarket_analyzer.airdrop_heuristic(summary)
        
        # Complete the job
        jobs[job_id]['status'] = 'completed'
        jobs[job_id]['progress'] = {
            'step': 'scoring',
            'percentage': 100,
            'message': 'Analysis complete'
        }
        jobs[job_id]['summary'] = {
            'eoa': summary.eoa,
            'proxy': summary.proxy,
            'first_trade_ts': summary.first_trade_ts,
            'first_trade_market': summary.first_trade_market,
            'trade_count': summary.trade_count,
            'total_volume_usd': summary.total_volume_usd,
            'unique_markets': summary.unique_markets,
            'unique_days_active': summary.unique_days_active,
            'open_positions_value_usd': summary.open_positions_value_usd,
            'realized_pnl_usd': summary.realized_pnl_usd,
            'first_trade_human': summary.first_trade_human()
        }
        jobs[job_id]['airdrop'] = airdrop
        
    except Exception as e:
        jobs[job_id]['status'] = 'error'
        jobs[job_id]['error'] = {
            'code': 'ANALYSIS_FAILED',
            'message': str(e),
            'retryable': True
        }


@app.route('/')
def index():
    """Serve the main HTML page."""
    return send_from_directory('static', 'index.html')


@app.route('/api/analyze', methods=['POST'])
def analyze():
    """Start a new wallet analysis job.
    
    Request body:
        {
            "address": "0x...",
            "rpc_url": "https://..." (optional)
        }
    
    Response:
        {
            "job_id": "uuid",
            "address": "0x...",
            "status": "in_progress"
        }
    """
    cleanup_old_jobs()
    
    data = request.get_json()
    address = data.get('address', '').lower().strip()
    rpc_url = data.get('rpc_url', polymarket_analyzer.DEFAULT_RPC)
    
    # Validate address
    if not address or not address.startswith('0x') or len(address) != 42:
        return jsonify({
            'error': 'Invalid address format. Expected 0x-prefixed 42-character string.'
        }), 400
    
    # Check if we already have a recent job for this address
    for job_id, job in jobs.items():
        if (job.get('address') == address and 
            job.get('status') in ['in_progress', 'completed'] and
            time.time() - job.get('timestamp', 0) < 300):  # 5 minutes
            return jsonify({
                'job_id': job_id,
                'address': address,
                'status': job['status']
            })
    
    # Create new job
    job_id = str(uuid.uuid4())
    jobs[job_id] = {
        'address': address,
        'status': 'pending',
        'timestamp': time.time(),
        'qualityWarnings': [],
        'progress': {
            'step': 'pending',
            'percentage': 0,
            'message': 'Starting analysis...'
        }
    }
    
    # Start async analysis
    thread = Thread(target=analyze_wallet_async, args=(job_id, address, rpc_url))
    thread.daemon = True
    thread.start()
    
    return jsonify({
        'job_id': job_id,
        'address': address,
        'status': 'in_progress'
    })


@app.route('/api/job/<job_id>', methods=['GET'])
def get_job_status(job_id: str):
    """Get the status of an analysis job.
    
    Response includes:
        - status: pending, in_progress, completed, error
        - progress: current step and percentage
        - qualityWarnings: array of warnings
        - summary: analysis results (if completed)
        - airdrop: airdrop score (if completed)
        - error: error details (if error)
    """
    cleanup_old_jobs()
    
    job = jobs.get(job_id)
    if not job:
        return jsonify({
            'error': 'Job not found or expired'
        }), 404
    
    # Return job state
    response = {
        'job_id': job_id,
        'address': job['address'],
        'status': job['status'],
        'timestamp': job['timestamp'],
        'progress': job.get('progress', {}),
        'qualityWarnings': job.get('qualityWarnings', [])
    }
    
    if job['status'] == 'completed':
        response['summary'] = job.get('summary')
        response['airdrop'] = job.get('airdrop')
    elif job['status'] == 'error':
        response['error'] = job.get('error')
    
    return jsonify(response)


@app.route('/api/health', methods=['GET'])
def health():
    """Health check endpoint."""
    return jsonify({
        'status': 'ok',
        'active_jobs': len([j for j in jobs.values() if j['status'] == 'in_progress']),
        'total_jobs': len(jobs)
    })


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
