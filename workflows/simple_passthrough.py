import pandas as pd
import psutil


def process(df: pd.DataFrame) -> pd.DataFrame:

    print(f"Process ID: {psutil.Process().pid}")
    print(f"Received DataFrame with shape: {df.shape}")
    print(f"Columns: {', '.join(df.columns)}")
    
    return df
