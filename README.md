# Exray

Exray is a distributed synthetic data generation application built with FastAPI and React that runs on Kubernetes.

## Installation

> Note: Ensure SSH with root access is configured for all nodes in the cluster before proceeding with the installation.

To install Exray, follow these steps:

1. Clone the repository:
   ```bash
   git clone https://github.com/ameen-91/exray.git
   ```

2. Setup a virtual environment and activate it:
   ```bash
   python -m venv venv
   source venv/bin/activate
   ```
> There is no windows support at the moment. Due to Ansible's limitations.

3. Install the required dependencies:
   ```bash
   pip install -r requirements.txt
   ```

# Exray

Exray is a distributed synthetic data generation application built with FastAPI and React that runs on Kubernetes.

## Installation

> Note: Ensure SSH with root access is configured for all nodes in the cluster before proceeding with the installation.

To install Exray, follow these steps:

1. Clone the repository:
   ```bash
   git clone https://github.com/ameen-91/exray.git
   ```

2. Setup a virtual environment and activate it:
   ```bash
   python -m venv venv
   source venv/bin/activate
   ```
> There is no windows support at the moment. Due to Ansible's limitations.

3. Install the required dependencies:
   ```bash
   pip install -r requirements.txt
   ```

4. Setup the cluster:
   ```bash
   python cluster.py add <node_ip>
   ```

   or use directly create a cluster.json file to define the cluster nodes:

   ```json
   {
     "nodes": [
       {
         "ip": "w.x.y.z",
         "role": "master"
       },
       {
         "ip": "w.x.y.z",
         "role": "worker"
       },
       {
         "ip": "w.x.y.z",
         "role": "worker"
       }
     ]
   }
   ```

   ```bash
   python cluster.py refresh
   ```

5. Start the the application:
   ```bash
   uvicorn main:app
   ```

6. Open your browser and navigate to `http://localhost:8000` to access the application.