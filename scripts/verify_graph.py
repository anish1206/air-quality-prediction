"""
Causal Graph Verification Script for NAICEWS
Validates the computed causal graph and generates network visualization.
"""

import json
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import networkx as nx
from pathlib import Path

# Paths
PROJECT_ROOT = Path(__file__).parent.parent
CAUSAL_GRAPH_PATH = PROJECT_ROOT / "data" / "models" / "causal_graph.json"
CITIES_METADATA_PATH = PROJECT_ROOT / "data" / "raw" / "cities_metadata.json"
CLUSTER_METADATA_PATH = PROJECT_ROOT / "data" / "processed" / "airshed_clusters.json"
OUTPUT_PATH = PROJECT_ROOT / "data" / "models" / "causal_network_map.png"


def load_causal_graph():
    """Load causal graph JSON."""
    print("Loading causal graph...")
    with open(CAUSAL_GRAPH_PATH, 'r') as f:
        data = json.load(f)
    return data


def load_metadata():
    """Load cities and cluster metadata."""
    with open(CITIES_METADATA_PATH, 'r') as f:
        cities_metadata = json.load(f)
    with open(CLUSTER_METADATA_PATH, 'r') as f:
        cluster_metadata = json.load(f)
    return cities_metadata, cluster_metadata


def print_graph_summary(data):
    """Print summary of the causal graph."""
    print("\n" + "=" * 80)
    print("CAUSAL GRAPH SUMMARY")
    print("=" * 80)
    
    metadata = data['graph_metadata']
    edges = data['edges']
    
    print(f"\nGraph Metadata:")
    print(f"  Nodes: {metadata['node_count']}")
    print(f"  Edges: {metadata['edge_count']}")
    print(f"  Generated: {metadata['generated_at']}")
    
    print(f"\nEdge Statistics:")
    correlations = [e['correlation_coefficient'] for e in edges]
    delays = [e['delay_hours'] for e in edges]
    p_values = [e['granger_p_value'] for e in edges if e['granger_p_value'] is not None]
    
    print(f"  Correlation - Min: {min(correlations):.3f}, Max: {max(correlations):.3f}, Mean: {np.mean(correlations):.3f}")
    print(f"  Delay (hours) - Min: {min(delays)}h, Max: {max(delays)}h, Mean: {np.mean(delays):.1f}h")
    
    if p_values:
        print(f"  P-value - Min: {min(p_values):.6f}, Max: {max(p_values):.6f}, Mean: {np.mean(p_values):.6f}")
    else:
        print(f"  P-value: Not computed (using correlation-based analysis)")
    
    # Check correlation threshold
    low_corr_edges = [e for e in edges if e['correlation_coefficient'] < 0.40]
    if low_corr_edges:
        print(f"\n⚠️  WARNING: {len(low_corr_edges)} edges have correlation < 0.40")
    else:
        print(f"\n✅ All edges meet correlation >= 0.40 threshold")
    
    # Group by transmission type
    transmission_types = {}
    for edge in edges:
        ttype = edge['transmission_type']
        transmission_types[ttype] = transmission_types.get(ttype, 0) + 1
    
    print(f"\nTransmission Types:")
    for ttype, count in transmission_types.items():
        print(f"  {ttype}: {count}")


def print_causal_chains(edges):
    """Print discovered causal chains."""
    print("\n" + "=" * 80)
    print("CAUSAL CHAINS")
    print("=" * 80)
    
    # Build adjacency list
    adjacency = {}
    for edge in edges:
        source = edge['source_node']
        target = edge['target_node']
        delay = edge['delay_hours']
        
        if source not in adjacency:
            adjacency[source] = []
        adjacency[source].append((target, delay))
    
    # Find chains (simple path following)
    print("\nDiscovered causal chains (showing top 10):")
    
    chains = []
    for source in adjacency:
        for target, delay in adjacency[source]:
            chain = [(source, target, delay)]
            
            # Try to extend chain
            current = target
            visited = {source, target}
            
            while current in adjacency:
                found_next = False
                for next_target, next_delay in adjacency[current]:
                    if next_target not in visited:
                        chain.append((current, next_target, next_delay))
                        visited.add(next_target)
                        current = next_target
                        found_next = True
                        break
                
                if not found_next or len(chain) > 5:
                    break
            
            if len(chain) >= 2:
                chains.append(chain)
    
    # Sort by chain length
    chains.sort(key=len, reverse=True)
    
    # Display top chains
    for i, chain in enumerate(chains[:10], 1):
        chain_str = " -> ".join([f"{src} ({delay}h)" for src, _, delay in chain])
        chain_str += f" -> {chain[-1][1]}"
        print(f"  {i}. {chain_str}")


def plot_network_graph(data, cities_metadata, cluster_metadata):
    """Generate network diagram visualization."""
    print("\nGenerating network diagram...")
    
    edges = data['edges']
    
    # Create NetworkX graph
    G = nx.DiGraph()
    
    # Add nodes with positions
    city_positions = {}
    city_clusters = {}
    cluster_colors = {}
    
    for city in cities_metadata:
        city_id = city['id']
        G.add_node(city_id)
        # Use (lon, lat) as position
        city_positions[city_id] = (city['lon'], city['lat'])
    
    # Get cluster colors
    for cluster in cluster_metadata:
        cluster_colors[cluster['cluster_id']] = cluster['color_hex']
    
    # Get city cluster assignments
    with open(PROJECT_ROOT / "data" / "processed" / "city_cluster_mapping.json", 'r') as f:
        city_cluster_mapping = json.load(f)
    
    for city_id, cluster_id in city_cluster_mapping.items():
        city_clusters[city_id] = cluster_id
    
    # Add edges
    for edge in edges:
        G.add_edge(edge['source_node'], edge['target_node'],
                  weight=edge['correlation_coefficient'])
    
    # Create figure
    fig, ax = plt.subplots(figsize=(14, 10))
    
    # Draw nodes colored by cluster
    node_colors = [cluster_colors[city_clusters[node]] for node in G.nodes()]
    nx.draw_networkx_nodes(G, city_positions, node_color=node_colors,
                          node_size=500, ax=ax, alpha=0.8)
    
    # Draw edges with varying thickness based on correlation
    edge_weights = [G[u][v]['weight'] for u, v in G.edges()]
    nx.draw_networkx_edges(G, city_positions, width=[w * 3 for w in edge_weights],
                          edge_color='gray', alpha=0.5, arrows=True,
                          arrowsize=20, ax=ax, arrowstyle='->')
    
    # Draw labels
    nx.draw_networkx_labels(G, city_positions, font_size=9, font_weight='bold',
                          ax=ax, bbox=dict(boxstyle='round,pad=0.3',
                                         facecolor='white', alpha=0.8))
    
    # Set title and limits
    ax.set_title('NAICEWS Causal Airshed Network\nDirected Pollution Transport Pathways',
                fontsize=14, fontweight='bold')
    ax.set_xlim(68, 98)
    ax.set_ylim(6, 38)
    ax.set_xlabel('Longitude', fontsize=11)
    ax.set_ylabel('Latitude', fontsize=11)
    ax.grid(True, alpha=0.3, linestyle='--')
    
    # Add legend for clusters
    legend_elements = []
    for cluster in cluster_metadata:
        legend_elements.append(plt.Rectangle((0, 0), 1, 1, fc=cluster['color_hex'],
                                            alpha=0.8, label=cluster['cluster_name']))
    
    ax.legend(handles=legend_elements, loc='upper right', fontsize=9,
             framealpha=0.9, bbox_to_anchor=(1.0, 1.0))
    
    plt.tight_layout()
    
    # Save plot
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    plt.savefig(OUTPUT_PATH, dpi=150, bbox_inches='tight')
    print(f"Saved network diagram to: {OUTPUT_PATH}")
    plt.close()


def main():
    """Main execution function."""
    print("=" * 80)
    print("NAICEWS Causal Graph Verification")
    print("=" * 80)
    
    # Load data
    data = load_causal_graph()
    cities_metadata, cluster_metadata = load_metadata()
    
    # Print summary
    print_graph_summary(data)
    
    # Print causal chains
    print_causal_chains(data['edges'])
    
    # Generate network diagram
    plot_network_graph(data, cities_metadata, cluster_metadata)
    
    print("\n" + "=" * 80)
    print("✅ Causal graph verification completed successfully!")
    print("=" * 80)


if __name__ == "__main__":
    main()
